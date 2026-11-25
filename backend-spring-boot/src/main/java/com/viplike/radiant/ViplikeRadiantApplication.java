package com.viplike.radiant;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ViplikeRadiantApplication {

    public static void main(String[] args) {
        SpringApplication.run(ViplikeRadiantApplication.class, args);
        System.out.println("\n==================================================================");
        System.out.println("✨ VIPLIKE RADIANT JAVA SPRING BOOT SERVER RUNNING ON PORT 8080");
        System.out.println("💎 Integrated directly with MySQL Workbench (Database: autopost_saas)");
        System.out.println("👑 User Management, Permissions & Software Rental Licensing");
        System.out.println("==================================================================\n");
    }
}
