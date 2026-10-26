package com.viplike.radiant.dto;

public class LicenseActivateRequest {
    private String licenseKey;
    private String hardwareHwid;

    public LicenseActivateRequest() {}

    public String getLicenseKey() { return licenseKey; }
    public void setLicenseKey(String licenseKey) { this.licenseKey = licenseKey; }

    public String getHardwareHwid() { return hardwareHwid; }
    public void setHardwareHwid(String hardwareHwid) { this.hardwareHwid = hardwareHwid; }
}
