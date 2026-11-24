package com.example;

import java.io.IOException;
import java.nio.file.Path;

public class Writer {
    private final Path base;

    public Writer(Path base) {
        this.base = base;
    }

    // TODO: 实现带边界校验的写入，返回写入的字节数。
    public int write(Path target, String content) throws IOException {
        throw new UnsupportedOperationException("not implemented");
    }
}
