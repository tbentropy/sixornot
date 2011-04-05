/* Original code from http://starkravingfinkle.org/blog/2011/01/bootstrap-jones-adventures-in-restartless-add-ons/, modified with thanks to Mark Finkle */

var Cc = Components.classes;
var Ci = Components.interfaces;

function loadIntoWindow(window) {
    if (!window) return;

    // Get the anchor for "overlaying" but make sure the UI is loaded
    let urlbaricons = window.document.getElementById("urlbar-icons");
    if (!urlbaricons) return;

    let starbutton = window.document.getElementById("star-button");

    // Place the new button after the last button in the top set
    let anchor = urlbaricons.nextSibling;

    let box = window.document.createElement("box");
    box.setAttribute("id", "sixornot-button");
    box.setAttribute("width", "16");
    box.setAttribute("height", "16");
    box.setAttribute("align", "center");
    box.setAttribute("pack", "center");

    let boxicon = window.document.createElement("image");
    boxicon.setAttribute("id", "sixornot-icon");
    boxicon.setAttribute("tooltip", "sixornot-tooltip");
    boxicon.setAttribute("width", "16");
    boxicon.setAttribute("height", "16");
    boxicon.setAttribute("src", "resource://sixornot/skin/icons/sixornot_button_v6only_16.png");

    let boxicontt = window.document.createElement("tooltip");
    boxicontt.setAttribute("id", "sixornot-tooltip");

    box.appendChild(boxicon);
    box.appendChild(boxicontt);
    // If star icon visible, insert before it, otherwise just append to urlbaricons
    if (!starbutton)
    {
        urlbaricons.appendChild(box);
    }
    else
    {
        urlbaricons.insertBefore(box, starbutton);
    }


}

function unloadFromWindow(window) {
    if (!window) return;
    let box = window.document.getElementById("sixornot-button");
    if (box)
    {
        box.parentNode.removeChild(box);
    }
}

/*
 bootstrap.js API
*/
function startup(aData, aReason) {
    Components.utils.import("resource://gre/modules/Services.jsm");
    let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

    let resource = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let alias = Services.io.newFileURI(aData.installPath);
    if (!aData.installPath.isDirectory())
    {
        alias = Services.io.newURI("jar:" + alias.spec + "!/", null, null);
    }
    resource.setSubstitution("sixornot", alias);

    // Load into any existing windows
    let enumerator = wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
        let win = enumerator.getNext().QueryInterface(Ci.nsIDOMWindow);
        loadIntoWindow(win);
        let scope = {};
        Components.utils.import("resource://sixornot/chrome/content/sixornot.js", scope);
        scope.Sixornot.init(win);
    }

    // Load into any new windows
    wm.addListener({
        onOpenWindow: function(aWindow) {
            // Wait for the window to finish loading
            let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal);
            domWindow.addEventListener("load", function() {
                domWindow.removeEventListener("load", arguments.callee, false);
                loadIntoWindow(domWindow);
                let scope = {};
                Components.utils.import("resource://sixornot/chrome/content/sixornot.js", scope);
                scope.Sixornot.init(domWindow);
            }, false);
        },
        onCloseWindow: function(aWindow) { },
        onWindowTitleChange: function(aWindow, aTitle) { }
    });
}

function shutdown(aData, aReason) {
    // When the application is shutting down we normally don't have to clean up any UI changes
    if (aReason == APP_SHUTDOWN) return;

    let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

    // Unload from any existing windows
    let enumerator = wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
        let win = enumerator.getNext().QueryInterface(Ci.nsIDOMWindow);
        unloadFromWindow(win);
    }
}

function install(aData, aReason) { }

function uninstall(aData, aReason) { }

