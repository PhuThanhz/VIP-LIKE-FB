package com.viplike.radiant.controller;

import com.viplike.radiant.dto.ApiResponse;
import com.viplike.radiant.dto.AuthRequest;
import com.viplike.radiant.dto.AuthResponse;
import com.viplike.radiant.dto.RegisterRequest;
import com.viplike.radiant.model.User;
import com.viplike.radiant.service.AuthService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ApiResponse<AuthResponse> login(@RequestBody AuthRequest request) {
        return authService.login(request);
    }

    @PostMapping("/register")
    public ApiResponse<AuthResponse> register(@RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @GetMapping("/me")
    public ApiResponse<User> me(Authentication authentication) {
        if (authentication == null) {
            return ApiResponse.fail("Chưa đăng nhập.");
        }
        return authService.getCurrentUser(authentication.getName());
    }
}
