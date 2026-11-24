package com.example;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

public class SelfTest {
    public static void main(String[] args) throws Exception {
        String actual = Formatter.format("a", 2) + "\n" + Formatter.format("b", 5) + "\n";
        String expected = new String(Files.readAllBytes(Paths.get("expected.snapshot")), StandardCharsets.UTF_8);
        if (!actual.equals(expected)) {
            System.err.println("快照不一致：\n实际:\n" + actual + "\n期望:\n" + expected);
            System.exit(1);
        }
        System.out.println("OK");
    }
}
