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
            return ApiResponse.fail("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");
        }

        Optional<User> userOpt = userRepository.findByUsername(request.getUsername().trim())
                .or(() -> userRepository.findByEmail(request.getUsername().trim()));

        if (userOpt.isEmpty()) {
            return ApiResponse.fail("Tài khoản không tồn tại trên hệ thống.");
        }

        User user = userOpt.get();

        if ("BANNED".equalsIgnoreCase(user.getStatus())) {
            return ApiResponse.fail("Tài khoản của bạn đã bị khóa.");
        }

        boolean passwordMatch = passwordEncoder.matches(request.getPassword(), user.getPasswordHash());
        // Hỗ trợ trường hợp admin123 plain text fallback trong giai đoạn test
        if (!passwordMatch && "admin123".equals(request.getPassword()) && "admin".equalsIgnoreCase(user.getUsername())) {
            passwordMatch = true;
            user.setPasswordHash(passwordEncoder.encode("admin123"));
            userRepository.save(user);
        }

        if (!passwordMatch) {
            return ApiResponse.fail("Mật khẩu không chính xác.");
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

        return ApiResponse.ok("Đăng nhập thành công!", authResponse);
    }

    public ApiResponse<AuthResponse> register(RegisterRequest request) {
        if (request.getUsername() == null || request.getPassword() == null || request.getEmail() == null) {
            return ApiResponse.fail("Vui lòng điền đầy đủ thông tin đăng ký.");
        }

        String username = request.getUsername().trim();
        String email = request.getEmail().trim();

        if (userRepository.existsByUsername(username)) {
            return ApiResponse.fail("Tên đăng nhập đã được sử dụng.");
        }

        if (userRepository.existsByEmail(email)) {
            return ApiResponse.fail("Email đã được đăng ký trên hệ thống.");
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

        return ApiResponse.ok("Đăng ký tài khoản thành công!", authResponse);
    }

    public ApiResponse<User> getCurrentUser(String username) {
        return userRepository.findByUsername(username)
                .map(ApiResponse::ok)
                .orElseGet(() -> ApiResponse.fail("Không tìm thấy thông tin tài khoản."));
    }
}
