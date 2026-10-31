package com.scaffold.system.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Serve the Actions-built Vue app and its known client-side deep links. */
@Controller
public class InstitutionUiController {
    @GetMapping({"/login", "/dashboard", "/no-access", "/system", "/system/{*path}",
        "/monitor", "/monitor/{*path}", "/tool", "/tool/{*path}",
        "/workproof", "/workproof/{*path}"})
    public String index() {
        return "forward:/index.html";
    }
}
