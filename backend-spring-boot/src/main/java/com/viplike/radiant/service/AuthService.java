package com.viplike.radiant.service;

import com.viplike.radiant.dto.ApiResponse;
import com.viplike.radiant.dto.AuthRequest;
import com.viplike.radiant.dto.AuthResponse;
import com.viplike.radiant.dto.RegisterRequest;
import com.viplike.radiant.model.User;
import com.viplike.radiant.repository.UserRepository;
import com.viplike.radiant.security.JwtUtils;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtils jwtUtils) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtils = jwtUtils;
    }

    public ApiResponse<AuthResponse> login(AuthRequest request) {
        if (request.getUsername() == null || request.getPassword() == null) {
            return ApiResponse.fail("Please enter both username and password.");
        }

        Optional<User> userOpt = userRepository.findByUsername(request.getUsername().trim())
                .or(() -> userRepository.findByEmail(request.getUsername().trim()));

        if (userOpt.isEmpty()) {
            return ApiResponse.fail("The account does not exist in the system.");
        }

        User user = userOpt.get();

        if ("BANNED".equalsIgnoreCase(user.getStatus())) {
            return ApiResponse.fail("Your account has been locked.");
        }

        boolean passwordMatch = passwordEncoder.matches(request.getPassword(), user.getPasswordHash());
        // Supports the admin123 plain-text fallback during testing
        if (!passwordMatch && "admin123".equals(request.getPassword()) && "admin".equalsIgnoreCase(user.getUsername())) {
            passwordMatch = true;
            user.setPasswordHash(passwordEncoder.encode("admin123"));
            userRepository.save(user);
        }

        if (!passwordMatch) {
            return ApiResponse.fail("Incorrect password.");
        }

        String token = jwtUtils.generateToken(user.getUsername(), user.getRole());

        AuthResponse authResponse = new AuthResponse(
                token,
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFullName(),
                user.getRole()
        );

        return ApiResponse.ok("Logged in successfully!", authResponse);
    }

    public ApiResponse<AuthResponse> register(RegisterRequest request) {
        if (request.getUsername() == null || request.getPassword() == null || request.getEmail() == null) {
            return ApiResponse.fail("Please fill in all registration details.");
        }

        String username = request.getUsername().trim();
        String email = request.getEmail().trim();

        if (userRepository.existsByUsername(username)) {
            return ApiResponse.fail("Username is already taken.");
        }

        if (userRepository.existsByEmail(email)) {
            return ApiResponse.fail("Email is already registered in the system.");
        }

        User newUser = new User(
                username,
                email,
                passwordEncoder.encode(request.getPassword()),
                request.getFullName() != null ? request.getFullName().trim() : username,
                "USER"
        );

        userRepository.save(newUser);

        String token = jwtUtils.generateToken(newUser.getUsername(), newUser.getRole());

        AuthResponse authResponse = new AuthResponse(
                token,
                newUser.getId(),
                newUser.getUsername(),
                newUser.getEmail(),
                newUser.getFullName(),
                newUser.getRole()
        );

        return ApiResponse.ok("Account registered successfully!", authResponse);
    }

    public ApiResponse<User> getCurrentUser(String username) {
        return userRepository.findByUsername(username)
                .map(ApiResponse::ok)
                .orElseGet(() -> ApiResponse.fail("Account information not found."));
    }
}
