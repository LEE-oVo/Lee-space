package com.cybershow.service;

import org.springframework.stereotype.Service;

import java.util.Random;

/**
 * AI 对话服务（mock 实现）。
 * 后续接入真实大模型：读取 ai_mock_config 的 provider/api_key，
 * 按 provider 分发到对应模型 API 即可，Controller 与前端无需改动。
 */
@Service
public class AiService {

    private static final String[] MOCK_REPLIES = {
            "[MOCK] 我是赛博秀场的占位 AI，真实模型接入后这里会变得更聪明。",
            "[MOCK] 信号已收到。等待 API Key 注入，届时我会正式苏醒。",
            "[MOCK] 01000010 01101001 01110100 —— 这是二进制的 'Bit'，也是我目前的全部 vocabulary。",
            "[MOCK] 我的神经突触暂时接在 mock 服务器上，期待接入真实大模型的那一天。"
    };

    private final Random random = new Random();

    public String chat(String message) {
        // 模拟模型推理延迟
        try {
            Thread.sleep(200 + random.nextInt(300));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        String reply = MOCK_REPLIES[random.nextInt(MOCK_REPLIES.length)];
        return "你说：「" + (message == null ? "" : message) + "」\n" + reply;
    }
}
