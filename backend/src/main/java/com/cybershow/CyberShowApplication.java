package com.cybershow;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.cybershow.mapper")
public class CyberShowApplication {

    public static void main(String[] args) {
        SpringApplication.run(CyberShowApplication.class, args);
    }
}
