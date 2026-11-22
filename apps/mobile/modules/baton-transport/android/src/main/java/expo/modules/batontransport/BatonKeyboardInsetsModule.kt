package expo.modules.batontransport

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.ViewTreeObserver
import android.view.WindowInsets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class BatonKeyboardInsetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BatonKeyboardInsets")
    View(KeyboardInsetsView::class) {
      Events("onKeyboardOverlap")
    }
  }
}

/** Reports the part of the React screen still covered after native window resizing. */
class KeyboardInsetsView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  private val onKeyboardOverlap by EventDispatcher()
  private val position = IntArray(2)
  private val visibleFrame = Rect()
  private var lastOverlap = 0
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { reportOverlap() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    requestApplyInsets()
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
    super.onDetachedFromWindow()
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    reportOverlap()
    return super.onApplyWindowInsets(insets)
  }

  private fun reportOverlap() {
    if (!isAttachedToWindow || height == 0) return
    val insets = ViewCompat.getRootWindowInsets(this) ?: return
    val ime = WindowInsetsCompat.Type.ime()
    val keyboardBottomInset = insets.getInsets(ime).bottom
    val overlap = if (insets.isVisible(ime) && keyboardBottomInset > 0) {
      getLocationOnScreen(position)
      val windowManager = appContext.currentActivity?.windowManager
      val keyboardTop = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && windowManager != null) {
        windowManager.currentWindowMetrics.bounds.bottom - keyboardBottomInset
      } else {
        getWindowVisibleDisplayFrame(visibleFrame)
        visibleFrame.bottom
      }
      (position[1] + height - keyboardTop).coerceIn(0, height)
    } else {
      0
    }
    if (overlap != lastOverlap) {
      lastOverlap = overlap
      onKeyboardOverlap(mapOf("overlap" to overlap / resources.displayMetrics.density))
    }
  }
}
