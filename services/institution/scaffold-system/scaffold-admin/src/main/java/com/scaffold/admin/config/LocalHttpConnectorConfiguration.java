package com.scaffold.admin.config;

import org.apache.catalina.connector.Connector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Optional loopback HTTP UI beside the standard Spring-configured HTTPS port. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "workproof.local-http.enabled", havingValue = "true")
public class LocalHttpConnectorConfiguration {
    @Bean
    WebServerFactoryCustomizer<TomcatServletWebServerFactory> localHttpConnector(
            @Value("${workproof.local-http.port:18081}") int httpPort,
            @Value("${server.port:18443}") int httpsPort,
            @Value("${server.ssl.enabled:false}") boolean sslEnabled) {
        if (!sslEnabled || httpPort < 1024 || httpPort > 65535 || httpPort == httpsPort) {
            throw new IllegalArgumentException("Local HTTP connector requires HTTPS and a separate non-privileged HTTP port");
        }
        return factory -> {
            Connector connector = new Connector("org.apache.coyote.http11.Http11NioProtocol");
            if (!connector.setProperty("address", "127.0.0.1")) {
                throw new IllegalStateException("Could not bind the additional HTTP connector to loopback");
            }
            connector.setPort(httpPort);
            connector.setScheme("http");
            connector.setSecure(false);
            factory.addAdditionalTomcatConnectors(connector);
        };
    }
}
