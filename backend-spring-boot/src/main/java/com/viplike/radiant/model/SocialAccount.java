package com.viplike.radiant.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "social_accounts")
public class SocialAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId = 1L;

    @Column(length = 64)
    private String platform = "FACEBOOK_PROFILE";

    @Column(name = "platform_account_id", nullable = false, length = 128)
    private String platformAccountId;

    @Column(name = "access_token", nullable = false, columnDefinition = "TEXT")
    private String accessToken;

    @Column(name = "page_name", nullable = false)
    private String pageName;

    @Column(name = "account_type", length = 64)
    private String accountType = "PERSONAL_PROFILE_COOKIE";

    @Column(name = "proxy_url")
    private String proxyUrl;

    @Column(name = "token_status", length = 32)
    private String tokenStatus = "OK";

    @Column(name = "token_checked_at")
    private LocalDateTime tokenCheckedAt;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    public SocialAccount() {}

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getPlatform() { return platform; }
    public void setPlatform(String platform) { this.platform = platform; }

    public String getPlatformAccountId() { return platformAccountId; }
    public void setPlatformAccountId(String platformAccountId) { this.platformAccountId = platformAccountId; }

    public String getAccessToken() { return accessToken; }
    public void setAccessToken(String accessToken) { this.accessToken = accessToken; }

    public String getPageName() { return pageName; }
    public void setPageName(String pageName) { this.pageName = pageName; }

    public String getAccountType() { return accountType; }
    public void setAccountType(String accountType) { this.accountType = accountType; }

    public String getProxyUrl() { return proxyUrl; }
    public void setProxyUrl(String proxyUrl) { this.proxyUrl = proxyUrl; }

    public String getTokenStatus() { return tokenStatus; }
    public void setTokenStatus(String tokenStatus) { this.tokenStatus = tokenStatus; }

    public LocalDateTime getTokenCheckedAt() { return tokenCheckedAt; }
    public void setTokenCheckedAt(LocalDateTime tokenCheckedAt) { this.tokenCheckedAt = tokenCheckedAt; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
