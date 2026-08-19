package com.cybershow.controller;

import com.cybershow.dto.ChatRequest;
import com.cybershow.dto.Result;
import com.cybershow.service.AiService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiService aiService;

    public AiController(AiService aiService) {
        this.aiService = aiService;
    }

    /**
     * AI 对话骨架：当前返回 mock 回复，接入真实模型时只改 AiService。
     */
    @PostMapping("/chat")
    public Result<String> chat(@RequestBody ChatRequest request) {
        return Result.ok(aiService.chat(request.getMessage()));
    }
}
