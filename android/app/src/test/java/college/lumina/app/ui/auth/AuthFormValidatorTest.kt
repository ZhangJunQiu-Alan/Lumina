package college.lumina.app.ui.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthFormValidatorTest {
    @Test
    fun loginRequiresValidEmail() {
        assertEquals(
            "请输入有效的邮箱地址。",
            AuthFormValidator.validateLogin("not-an-email", "password"),
        )
    }

    @Test
    fun validLoginPassesValidation() {
        assertNull(AuthFormValidator.validateLogin("learner@example.com", "password"))
    }

    @Test
    fun registrationRequiresEightCharacterPassword() {
        assertEquals(
            "密码至少需要 8 位。",
            AuthFormValidator.validateRegistration(
                fullName = "Learner",
                email = "learner@example.com",
                password = "short",
                confirmPassword = "short",
            ),
        )
    }

    @Test
    fun registrationRequiresMatchingPasswords() {
        assertEquals(
            "两次输入的密码不一致。",
            AuthFormValidator.validateRegistration(
                fullName = "Learner",
                email = "learner@example.com",
                password = "password-a",
                confirmPassword = "password-b",
            ),
        )
    }

    @Test
    fun validRegistrationPassesValidation() {
        assertNull(
            AuthFormValidator.validateRegistration(
                fullName = "Learner",
                email = "learner@example.com",
                password = "password",
                confirmPassword = "password",
            ),
        )
    }
}
