package com.example;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class SelfTest {
    public static void main(String[] args) throws IOException {
        Path base = Files.createTempDirectory("cp-feat-03");
        Writer writer = new Writer(base);

        int written = writer.write(base.resolve("nested/out.txt"), "hello");
        if (written != 5) {
            throw new IllegalStateException("写入字节数应为 5，实际 " + written);
        }
        String content = new String(Files.readAllBytes(base.resolve("nested/out.txt")), StandardCharsets.UTF_8);
        if (!"hello".equals(content)) {
            throw new IllegalStateException("写入内容不符");
        }

        boolean rejected = false;
        try {
            writer.write(base.resolve("../escape.txt"), "nope");
        } catch (IllegalArgumentException expected) {
            rejected = true;
        }
        if (!rejected) {
            throw new IllegalStateException("越界写入必须被拒绝");
        }
        if (Files.exists(base.getParent().resolve("escape.txt"))) {
            throw new IllegalStateException("越界写入产生了副作用");
        }

        System.out.println("OK");
    }
}
