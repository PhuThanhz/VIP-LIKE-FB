package com.viplike.radiant.controller;

import com.viplike.radiant.dto.ApiResponse;
import com.viplike.radiant.model.SocialAccount;
import com.viplike.radiant.repository.SocialAccountRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final SocialAccountRepository accountRepository;

    public AccountController(SocialAccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @GetMapping
    public ApiResponse<List<SocialAccount>> getAllAccounts() {
        return ApiResponse.ok(accountRepository.findAllByOrderByIdDesc());
    }

    @PostMapping
    public ApiResponse<SocialAccount> addAccount(@RequestBody SocialAccount account) {
        if (account.getPageName() == null || account.getPageName().isEmpty()) {
            account.setPageName("Via " + System.currentTimeMillis());
        }
        SocialAccount saved = accountRepository.save(account);
        return ApiResponse.ok("Lưu tài khoản thành công", saved);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<String> deleteAccount(@PathVariable Long id) {
        accountRepository.deleteById(id);
        return ApiResponse.ok("Xóa tài khoản thành công", "ID: " + id);
    }
}
