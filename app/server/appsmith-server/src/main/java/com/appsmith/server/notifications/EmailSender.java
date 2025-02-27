package com.appsmith.server.notifications;

import com.appsmith.server.configurations.EmailConfig;
import com.github.mustachejava.DefaultMustacheFactory;
import com.github.mustachejava.Mustache;
import com.github.mustachejava.MustacheFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import reactor.core.Exceptions;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import javax.mail.MessagingException;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import java.io.IOException;
import java.io.StringWriter;
import java.io.UnsupportedEncodingException;
import java.util.Map;

import static com.appsmith.server.helpers.ValidationUtils.validateEmail;

@Component
@Slf4j
public class EmailSender {

    private final JavaMailSender javaMailSender;

    private final EmailConfig emailConfig;

    private final InternetAddress MAIL_FROM;

    private final InternetAddress REPLY_TO;

    public EmailSender(JavaMailSender javaMailSender, EmailConfig emailConfig) {
        this.javaMailSender = javaMailSender;
        this.emailConfig = emailConfig;

        MAIL_FROM = makeFromAddress();
        REPLY_TO = makeReplyTo();
    }

    public Mono<Boolean> sendMail(String to, String subject, String text, Map<String, String> params) {

        /**
         * Creating a publisher which sends email in a blocking fashion, subscribing on the bounded elastic
         * scheduler and then subscribing to it so that the publisher starts emitting immediately. We do not
         * wait for the blocking call of `sendMailSync` to finish. BoundedElastic scheduler would ensure that
         * when the number of tasks go beyond the number of available threads, the tasks would be deferred till
         * a thread becomes available without overloading the server.
         */
        Mono.fromCallable(() -> {
                    try {
                        return replaceEmailTemplate(text, params);
                    } catch (IOException e) {
                        throw Exceptions.propagate(e);
                    }
                })
                .doOnNext(emailBody -> {
                    sendMailSync(to, subject, emailBody);
                })
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe();

        // Creating a hot source which would be created, emitted, and returned immediately.
        return Mono.just(Boolean.TRUE);
    }

    /**
     * [Synchronous]This function sends an HTML email to the user from the default email address
     *
     * @param to      Single valid string email address to send to. Multiple addresses doesn't work.
     * @param subject Subject string.
     * @param text    HTML Body of the message. This method assumes UTF-8.
     */
    private void sendMailSync(String to, String subject, String text) {
        log.debug("Got request to send email to: {} with subject: {}", to, subject);
        // Don't send an email for local, dev or test environments
        if (!emailConfig.isEmailEnabled()) {
            return;
        }

        // Check if the email address is valid. It's possible for certain OAuth2 providers to not return the email ID
        if (to == null || !validateEmail(to)) {
            log.error("The email ID: {} is not valid. Not sending an email", to);
            return;
        }

        log.debug("Going to send email to {} with subject {}", to, subject);
        MimeMessage mimeMessage = javaMailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, "utf-8");

        try {
            helper.setTo(to);
            if (MAIL_FROM != null) {
                helper.setFrom(MAIL_FROM);
            }
            if (REPLY_TO != null) {
                helper.setReplyTo(REPLY_TO);
            }
            helper.setSubject(subject);
            helper.setText(text, true);
            javaMailSender.send(mimeMessage);

            log.debug("Email sent successfully to {} with subject {}", to, subject);
        } catch (MessagingException e) {
            log.error("Unable to create the mime message while sending an email to {} with subject: {}. Cause: ", to, subject, e);
        } catch (MailException e) {
            log.error("Unable to send email. Cause: ", e);
        }
    }

    /**
     * This function replaces the variables in an email template to actual values. It uses the Mustache SDK.
     *
     * @param template The name of the template where the HTML text can be found
     * @param params   A Map of key-value pairs with the key being the variable in the template & value being the actual
     *                 value with which it must be replaced.
     * @return Template string with Mustache replacements applied.
     * @throws IOException bubbled from Mustache renderer.
     */
    private String replaceEmailTemplate(String template, Map<String, String> params) throws IOException {
        MustacheFactory mf = new DefaultMustacheFactory();
        StringWriter stringWriter = new StringWriter();
        Mustache mustache = mf.compile(template);
        mustache.execute(stringWriter, params).flush();
        return stringWriter.toString();
    }

    private InternetAddress makeFromAddress() {
        try {
            return new InternetAddress(this.emailConfig.getMailFrom(), "Appsmith");
        } catch (UnsupportedEncodingException e) {
            log.error("Encoding error creating Appsmith mail from address.", e);
            return null;
        }
    }

    private InternetAddress makeReplyTo() {
        try {
            return new InternetAddress(this.emailConfig.getReplyTo(), "Appsmith");
        } catch (UnsupportedEncodingException e) {
            log.error("Encoding error creating Appsmith reply to address.", e);
            return null;
        }
    }
}
