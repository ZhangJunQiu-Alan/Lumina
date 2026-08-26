package college.lumina.app.ui.auth

private val emailPattern = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

object AuthFormValidator {
    fun validateLogin(email: String, password: String): String? {
        if (!emailPattern.matches(email.trim())) return "请输入有效的邮箱地址。"
        if (password.isBlank()) return "请输入密码。"
        return null
    }

    fun validateRegistration(
        fullName: String,
        email: String,
        password: String,
        confirmPassword: String,
    ): String? {
        if (fullName.isBlank()) return "请输入你想显示的名字。"
        validateLogin(email, password)?.let { return it }
        if (password.length < 8) return "密码至少需要 8 位。"
        if (password != confirmPassword) return "两次输入的密码不一致。"
        return null
    }
}
