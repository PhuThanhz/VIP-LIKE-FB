package com.viplike.radiant.dto;

public class LicenseCreateRequest {
    private String customerName;
    private String customerContact;
    private String packageType = "1_MONTH";
    private Integer maxVias = 50;
    private Integer days = 30;
    private String notes;

    public LicenseCreateRequest() {}

    public String getCustomerName() { return customerName; }
    public void setCustomerName(String customerName) { this.customerName = customerName; }

    public String getCustomerContact() { return customerContact; }
    public void setCustomerContact(String customerContact) { this.customerContact = customerContact; }

    public String getPackageType() { return packageType; }
    public void setPackageType(String packageType) { this.packageType = packageType; }

    public Integer getMaxVias() { return maxVias; }
    public void setMaxVias(Integer maxVias) { this.maxVias = maxVias; }

    public Integer getDays() { return days; }
    public void setDays(Integer days) { this.days = days; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
}
