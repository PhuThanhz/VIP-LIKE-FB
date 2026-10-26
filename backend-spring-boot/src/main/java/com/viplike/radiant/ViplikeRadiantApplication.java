package com.viplike.radiant;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ViplikeRadiantApplication {

    public static void main(String[] args) {
        SpringApplication.run(ViplikeRadiantApplication.class, args);
        System.out.println("\n==================================================================");
        System.out.println("✨ VIPLIKE RADIANT JAVA SPRING BOOT SERVER ĐANG CHẠY TẠI PORT 8080");
        System.out.println("💎 Tích hợp trực tiếp MySQL Workbench (Database: autopost_saas)");
        System.out.println("👑 Quản lý Người Dùng, Phân Quyền & Cấp Bản Quyền Cho Thuê Phần Mềm");
        System.out.println("==================================================================\n");
    }
}
