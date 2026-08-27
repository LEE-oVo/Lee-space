package com.lee.portfolio;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 个人作品网站后端启动类
 * 前台访客接口（无鉴权） + 管理后台接口（JWT 鉴权）
 */
@SpringBootApplication
@MapperScan("com.lee.portfolio.mapper")
public class PortfolioApplication {

    public static void main(String[] args) {
        SpringApplication.run(PortfolioApplication.class, args);
    }
}
