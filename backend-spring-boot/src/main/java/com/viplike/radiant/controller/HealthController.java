package com.viplike.radiant.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public Map<String, Object> checkHealth() {
        Map<String, Object> resp = new HashMap<>();
        resp.put("service", "VIPLIKE RADIANT - Spring Boot Backend");
        resp.put("status", "UP");
        resp.put("port", 8080);
        resp.put("time", LocalDateTime.now().toString());

        try {
            Integer dbTest = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            resp.put("mysqlConnected", dbTest != null && dbTest == 1);
            resp.put("database", "autopost_saas");
        } catch (Exception e) {
            resp.put("mysqlConnected", false);
            resp.put("mysqlError", e.getMessage());
        }

        return resp;
    }
}
