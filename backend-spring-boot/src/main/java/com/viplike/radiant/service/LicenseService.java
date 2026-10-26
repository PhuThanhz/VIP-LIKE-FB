package com.viplike.radiant.service;

import com.viplike.radiant.dto.ApiResponse;
import com.viplike.radiant.dto.LicenseActivateRequest;
import com.viplike.radiant.dto.LicenseCreateRequest;
import com.viplike.radiant.model.SoftwareLicense;
import com.viplike.radiant.repository.SoftwareLicenseRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class LicenseService {

    private final SoftwareLicenseRepository licenseRepository;

    public LicenseService(SoftwareLicenseRepository licenseRepository) {
        this.licenseRepository = licenseRepository;
    }

    public ApiResponse<Map<String, Object>> getCurrentStatus() {
        Optional<SoftwareLicense> activeOpt = licenseRepository.findFirstByStatusOrderByCreatedAtDesc("ACTIVE");
        if (activeOpt.isEmpty()) {
            Map<String, Object> resp = new HashMap<>();
            resp.put("activated", false);
            resp.put("message", "Chưa kích hoạt bản quyền hoặc đã hết hạn thuê.");
            return ApiResponse.ok(resp);
        }

        SoftwareLicense lic = activeOpt.get();
        LocalDateTime now = LocalDateTime.now();
        boolean isExpired = lic.getExpiresAt().isBefore(now);
        long daysRemaining = Math.max(0, ChronoUnit.DAYS.between(now, lic.getExpiresAt()));

        Map<String, Object> licData = new HashMap<>();
        licData.put("licenseKey", lic.getLicenseKey());
        licData.put("customerName", lic.getCustomerName());
        licData.put("packageType", lic.getPackageType());
        licData.put("maxVias", lic.getMaxVias());
        licData.put("expiresAt", lic.getExpiresAt().toString());
        licData.put("daysRemaining", daysRemaining);
        licData.put("isExpired", isExpired);
        licData.put("status", isExpired ? "EXPIRED" : lic.getStatus());

        Map<String, Object> resp = new HashMap<>();
        resp.put("activated", !isExpired);
        resp.put("license", licData);

        return ApiResponse.ok(resp);
    }

    public ApiResponse<Map<String, Object>> activateLicense(LicenseActivateRequest request) {
        if (request.getLicenseKey() == null || request.getLicenseKey().trim().isEmpty()) {
            return ApiResponse.fail("Vui lòng cung cấp mã License Key.");
        }

        String key = request.getLicenseKey().trim();
        Optional<SoftwareLicense> licOpt = licenseRepository.findByLicenseKey(key);

        if (licOpt.isEmpty()) {
            return ApiResponse.fail("Mã License không tồn tại trên hệ thống máy chủ.");
        }

        SoftwareLicense lic = licOpt.get();

        if ("LOCKED".equalsIgnoreCase(lic.getStatus())) {
            return ApiResponse.fail("Mã License này đã bị KHÓA. Vui lòng liên hệ Admin.");
        }

        LocalDateTime now = LocalDateTime.now();
        if (lic.getExpiresAt().isBefore(now)) {
            return ApiResponse.fail("Mã License này đã HẾT HẠN sử dụng.");
        }

        String hwid = request.getHardwareHwid();
        if (lic.getHardwareHwid() != null && hwid != null && !lic.getHardwareHwid().equals(hwid)) {
            return ApiResponse.fail("License này đã được kích hoạt cho thiết bị khác (" + lic.getHardwareHwid() + "). Không thể dùng trên máy này.");
        }

        if (lic.getHardwareHwid() == null && hwid != null) {
            lic.setHardwareHwid(hwid);
        }
        if (lic.getActivatedAt() == null) {
            lic.setActivatedAt(now);
        }
        lic.setStatus("ACTIVE");
        licenseRepository.save(lic);

        long daysRemaining = Math.max(0, ChronoUnit.DAYS.between(now, lic.getExpiresAt()));

        Map<String, Object> licData = new HashMap<>();
        licData.put("licenseKey", lic.getLicenseKey());
        licData.put("customerName", lic.getCustomerName());
        licData.put("packageType", lic.getPackageType());
        licData.put("maxVias", lic.getMaxVias());
        licData.put("expiresAt", lic.getExpiresAt().toString());
        licData.put("daysRemaining", daysRemaining);
        licData.put("status", lic.getStatus());

        Map<String, Object> resp = new HashMap<>();
        resp.put("activated", true);
        resp.put("license", licData);

        return ApiResponse.ok("🎉 Kích hoạt Bản Quyền VIPLIKE RADIANT thành công!", resp);
    }

    public ApiResponse<List<SoftwareLicense>> getAllLicenses() {
        return ApiResponse.ok(licenseRepository.findAllByOrderByCreatedAtDesc());
    }

    public ApiResponse<SoftwareLicense> createLicense(LicenseCreateRequest request) {
        if (request.getCustomerName() == null || request.getCustomerName().trim().isEmpty()) {
            return ApiResponse.fail("Tên khách hàng thuê là bắt buộc.");
        }

        String randomCode = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        String generatedKey = "VIP-" + randomCode.substring(0, 4) + "-" + randomCode.substring(4);

        int days = request.getDays() != null && request.getDays() > 0 ? request.getDays() : 30;
        LocalDateTime expiresAt = LocalDateTime.now().plusDays(days);

        SoftwareLicense lic = new SoftwareLicense();
        lic.setLicenseKey(generatedKey);
        lic.setCustomerName(request.getCustomerName().trim());
        lic.setCustomerContact(request.getCustomerContact());
        lic.setPackageType(request.getPackageType() != null ? request.getPackageType() : "1_MONTH");
        lic.setMaxVias(request.getMaxVias() != null ? request.getMaxVias() : 50);
        lic.setStatus("ACTIVE");
        lic.setExpiresAt(expiresAt);
        lic.setNotes(request.getNotes());

        SoftwareLicense saved = licenseRepository.save(lic);
        return ApiResponse.ok("Đã tạo License Key thành công cho khách hàng: " + lic.getCustomerName(), saved);
    }

    public ApiResponse<SoftwareLicense> updateStatus(Long id, String status, Integer addDays) {
        Optional<SoftwareLicense> licOpt = licenseRepository.findById(id);
        if (licOpt.isEmpty()) {
            return ApiResponse.fail("Không tìm thấy License với ID: " + id);
        }

        SoftwareLicense lic = licOpt.get();
        if (status != null && !status.isEmpty()) {
            lic.setStatus(status);
        }

        if (addDays != null && addDays > 0) {
            LocalDateTime currentExpire = lic.getExpiresAt();
            LocalDateTime base = currentExpire.isAfter(LocalDateTime.now()) ? currentExpire : LocalDateTime.now();
            lic.setExpiresAt(base.plusDays(addDays));
        }

        SoftwareLicense updated = licenseRepository.save(lic);
        return ApiResponse.ok("Cập nhật trạng thái License thành công", updated);
    }
}
