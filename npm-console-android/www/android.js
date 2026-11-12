/* Android-only glue (loaded by the Android build, not by the desktop apps). */
(() => {
  const C = window.Capacitor, A = C && C.Plugins && C.Plugins.App;
  document.documentElement.classList.add('android-app');
  if (!A || !A.addListener) return;
  A.addListener('backButton', () => {
    // 1) close the topmost dialog
    const ovs = document.querySelectorAll('.modal-overlay.active');
    if (ovs.length) { const ov = ovs[ovs.length - 1]; ov.classList.remove('active'); if (/^sync/.test(ov.id)) ov.remove(); return; }
    // 2) from any other tab go back to Today
    const today = document.querySelector('#tabBar .tab-btn[data-tab="today"]'), act = document.querySelector('#tabBar .tab-btn.active');
    if (today && act && act !== today) { today.click(); return; }
    // 3) otherwise keep the app alive in the background instead of quitting
    A.minimizeApp && A.minimizeApp();
  });
})();
