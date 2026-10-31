package com.scaffold.admin.util;

import java.nio.charset.StandardCharsets;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Prebuilt JAR helper: no Spring context, database, password arguments or logs. */
public final class LocalPasswordHasher {
    private LocalPasswordHasher() {}

    public static void main(String[] args) throws Exception {
        byte[] input = System.in.readNBytes(1025);
        if (args.length != 0 || input.length < 16 || input.length > 72) {
            System.err.println("Expected a 16–72 byte password on stdin.");
            System.exit(2);
            return;
        }
        String password = new String(input, StandardCharsets.UTF_8);
        System.out.print(new BCryptPasswordEncoder().encode(password));
    }
}
