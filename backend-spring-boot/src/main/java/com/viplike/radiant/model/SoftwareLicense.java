package com.viplike.radiant.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "software_licenses")
public class SoftwareLicense {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "license_key", nullable = false, unique = true, length = 64)
    private String licenseKey;

    @Column(name = "customer_name", nullable = false, length = 128)
    private String customerName;

    @Column(name = "customer_contact", length = 128)
    private String customerContact;

    @Column(name = "hardware_hwid", length = 128)
    private String hardwareHwid;

    @Column(name = "package_type", length = 32)
    private String packageType = "1_MONTH";

    @Column(name = "max_vias")
    private Integer maxVias = 50;

    @Column(length = 32)
    private String status = "ACTIVE";

    @Column(name = "activated_at")
    private LocalDateTime activatedAt;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    public SoftwareLicense() {}

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getLicenseKey() { return licenseKey; }
    public void setLicenseKey(String licenseKey) { this.licenseKey = licenseKey; }

    public String getCustomerName() { return customerName; }
    public void setCustomerName(String customerName) { this.customerName = customerName; }

    public String getCustomerContact() { return customerContact; }
    public void setCustomerContact(String customerContact) { this.customerContact = customerContact; }

    public String getHardwareHwid() { return hardwareHwid; }
    public void setHardwareHwid(String hardwareHwid) { this.hardwareHwid = hardwareHwid; }

    public String getPackageType() { return packageType; }
    public void setPackageType(String packageType) { this.packageType = packageType; }

    public Integer getMaxVias() { return maxVias; }
    public void setMaxVias(Integer maxVias) { this.maxVias = maxVias; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public LocalDateTime getActivatedAt() { return activatedAt; }
    public void setActivatedAt(LocalDateTime activatedAt) { this.activatedAt = activatedAt; }

    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
