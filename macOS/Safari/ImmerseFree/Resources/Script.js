function show(enabled, useSettingsInsteadOfPreferences) {
  if (useSettingsInsteadOfPreferences) {
    document.getElementsByClassName("state-on")[0].innerText = "Safari 延伸功能已開啟。";
    document.getElementsByClassName("state-off")[0].innerText = "Safari 延伸功能目前未開啟。";
    document.getElementsByClassName("state-unknown")[0].innerText = "請在 Safari 的延伸功能設定中開啟 ImmerseFree。";
    document.getElementsByClassName("open-preferences")[0].innerText = "開啟 Safari 延伸功能設定";
  }

  if (typeof enabled === "boolean") {
    document.body.classList.toggle("state-on", enabled);
    document.body.classList.toggle("state-off", !enabled);
  } else {
    document.body.classList.remove("state-on");
    document.body.classList.remove("state-off");
  }
}

function openPreferences() {
  webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
