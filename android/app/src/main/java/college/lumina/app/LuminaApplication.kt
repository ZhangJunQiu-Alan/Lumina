package college.lumina.app

import android.app.Application
import college.lumina.app.data.AppContainer

class LuminaApplication : Application() {
    val container: AppContainer by lazy {
        AppContainer.create()
    }
}
