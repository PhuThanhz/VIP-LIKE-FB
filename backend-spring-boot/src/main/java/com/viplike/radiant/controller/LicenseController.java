package com.viplike.radiant.controller;

import com.viplike.radiant.dto.ApiResponse;
import com.viplike.radiant.dto.LicenseActivateRequest;
import com.viplike.radiant.dto.LicenseCreateRequest;
import com.viplike.radiant.model.SoftwareLicense;
import com.viplike.radiant.service.LicenseService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/licenses")
public class LicenseController {

    private final LicenseService licenseService;

    public LicenseController(LicenseService licenseService) {
        this.licenseService = licenseService;
    }

    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> getStatus() {
        return licenseService.getCurrentStatus();
    }

    @PostMapping("/activate")
    public ApiResponse<Map<String, Object>> activate(@RequestBody LicenseActivateRequest request) {
        return licenseService.activateLicense(request);
    }

    @GetMapping("/admin/list")
    public ApiResponse<List<SoftwareLicense>> getAllLicenses() {
        return licenseService.getAllLicenses();
    }

    @PostMapping("/admin/create")
    public ApiResponse<SoftwareLicense> createLicense(@RequestBody LicenseCreateRequest request) {
        return licenseService.createLicense(request);
    }

    @PostMapping("/admin/status")
    public ApiResponse<SoftwareLicense> updateStatus(@RequestBody Map<String, Object> body) {
        Long id = Long.valueOf(body.get("id").toString());
        String status = (String) body.get("status");
        Integer addDays = body.containsKey("addDays") ? Integer.valueOf(body.get("addDays").toString()) : 0;
        return licenseService.updateStatus(id, status, addDays);
    }
}
