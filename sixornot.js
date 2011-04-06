/* This is a JavaScript module (JSM) to be imported via Components.utils.import() and acts as a singleton.
   Only the following listed symbols will exposed on import, and only when and where imported. */

/* This library is heavily based on the excellent Flagfox addon by Dave Garrett
See flagfox.net for more information */

const EXPORTED_SYMBOLS = ["Sixornot"];

var SixornotVersion = "1";  // Fetched on startup; value here is a fallback

var mainPrefListener = null;
var warningsThisSession = [];


var hotKeys;
var hotClicks;

var actionsList = null;  // Loaded actions list (array of {name, template} with optional properties {iconclick, hotkey, show, custom})
var actionsListAge = 0;
var actionsSaveIsInProgress = false;

//// Main startup, shutdown, and event handling /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/* ready === undefined  -->  not yet started
   ready === null       -->  aborted startup
   ready === false      -->  startup in progress
   ready === true       -->  ready to do lookups */
var ready = undefined;

function startup()
{
    ready = false;  // Starting up...

    function handleStartupError(e)
    {
        ready = null;
        Sixornot.error("Fatal Sixornot startup error!",e);
        shutdown();
    }

    try
    {

        const id = "sixornot@entropy.me.uk";  // Sixornot ID

        if ("@mozilla.org/extensions/manager;1" in Components.classes)  // Gecko 1.9.x
        {
            var ExtensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                             .getService(Components.interfaces.nsIExtensionManager);
            SixornotVersion = ExtensionManager.getItemForID(id)
                                             .version;
            ready = true;
        }
        else  // Gecko 2.0+
        {
            Components.utils.import("resource://gre/modules/AddonManager.jsm");
            AddonManager.getAddonByID(id, function(addon) {
                try {
                    SixornotVersion = addon.version;
                    ready = true;
                } catch (e) { handleStartupError(e); }  // This callback is outside of the exception catching for startup()
            });
        }

//        Sixornot.actions.load();

//        migrateOldPrefs();
//        mergeDefaultActionUpdates();

        mainPrefListener = new PrefListener("sixornot.",onGlobalPrefChange);

        // Queue up final shutdown sequence; each window has its own unload sequence as well
        doOnShutdown(shutdown);
    }
    catch (e) { handleStartupError(e); }
}

function shutdown()
{
    if (mainPrefListener)
        mainPrefListener.unregister();
}

function onGlobalPrefChange(branch,prefName)
{
    switch (prefName)
    {
        case "actions":
            if (!actionsSaveIsInProgress)  // Reload if this wasn't our doing (manual pref edit/reset or Mozilla Weave Sync)
            {
                Sixornot.actions.load();
                mergeDefaultActionUpdates();  // Make sure changes to defaults list are handled correctly
            }
            return;

        case "showfavicons":
            actionsListAge = Date.now();  // All menus will need to be updated
            return;

        case "warn.tld":
        case "warn.proxy":
            if (!branch.prefHasUserValue(prefName))
                warningsThisSession = [];  // Reset list on pref reset
            return;
    }
}

//// Main Sixornot object (only variable exported out of this file) //////////////////////////////////////////////////////////////////////////////////////////////////////
var Sixornot =
{
    init : function(window)
    {
        if (ready === undefined)  // Startup if not done yet
            consoleService.logStringMessage("Sixornot - startup requested");
            startup();

        if (ready === null)  // Halt if startup was aborted
            return;

        // Load the icon for this window
        try { newIconInstance(window); }
        catch (e) { Sixornot.error("Error loading icon for window",e); }
    },

    shutdown : function(window)
    {
        if (ready)
            consoleService.logStringMessage("Sixornot - shutdown requested");
            shutdown();
    },

    warning : function(window,pref,message)  // Shows a slide-down info bar (max once per session for each unique message)
    {
        if (prefService.getCharPref(pref) == "disabled")  // Valid states are: "enabled", "once", & "disabled"
            return;  // Disabled by user

        var messageID = hashString(message);
        if (warningsThisSession.indexOf(messageID)!=-1)
            return;  // Shown before this session
        warningsThisSession.push(messageID);

        var notificationBox = window.getBrowser().getNotificationBox();

        const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
        var notification = window.document.createElementNS(XULNS,"notification");
        notification.setAttribute("type","warning");
        notification.setAttribute("priority",notificationBox.PRIORITY_WARNING_MEDIUM);
        notification.setAttribute("value",pref);
        notification.setAttribute("image","chrome://sixornot/content/icons/help.png");
        notification.setAttribute("label",message);

        var checkbox = window.document.createElementNS(XULNS,"checkbox");
        if (prefService.getCharPref(pref) == "once")  // If pref is "once", default to checked
        {
            checkbox.setAttribute("checked",true);
            prefService.setCharPref(pref,"disabled");
        }
        function onCheckboxToggled(event)
        {
            prefService.setCharPref(pref, event.target.checked ? "disabled" : "enabled");
        }
        checkbox.addEventListener("command",onCheckboxToggled,false);
        checkbox.setAttribute("label",strings.GetStringFromName("warnchecklabel"));
        notification.appendChild(checkbox);

        notification.setAttribute("persistence",100);  // Also give it a second of persistence to prevent accidental hide without user interaction
        window.setTimeout(function(){notification.removeAttribute("persistence");},1000);

        notificationBox.appendChild(notification);  // Add and show notification
        if (notificationBox._showNotification)
            notificationBox._showNotification(notification,true);  // Do slide animation (HACK: undocumented method...)

        // Fire event for accessibility APIs
        var event = window.document.createEvent("Events");
        event.initEvent("AlertActive", true, true);
        notification.dispatchEvent(event);
    },

    error : function(message,exception)  // This is more error info than others might do, but users have a bad habit of ignoring you if you don't ask for feedback
    {
        if (!message)
            message = "Unknown error!";

        logErrorMessage("Sixornot ERROR: " + message + " \n" + parseException(exception));

        try
        {
            // No L10N: We only speak English (well) and thus our forums and the problems reported on them need to be in English. Sorry.
            var outputMsg = "Sorry, the Sixornot extension has encountered a problem. " +
                            "The following error output and a Sixornot preferences dump has been sent to Tools -> Error Console.\n" +
                            "\n------------------------------------------------------------\n";

//            outputMsg += "FLAGFOX VERSION: " + Sixornot.version + " (" + Sixornot.getIPDBversion() + ")\n";

            outputMsg += "\nERROR MESSAGE: " + message + "\n";
            if (exception)
            {
                outputMsg += "\nEXCEPTION THROWN: " + exception + "\n";
                if (exception.stack)
                    outputMsg += "\nSTACK TRACE:\n" + cleanExceptionStack(exception.stack);  // ends with "\n"
            }

            try { logErrorMessage("Sixornot PREFERENCES DUMP:\n" + getPrefsDump("sixornot.")); }
            catch (prefsDumpError) { outputMsg += "\nEXCEPTION THROWN on preferences dump: " + parseException(prefsDumpError) + "\n"; }

            outputMsg += "\nBROWSER: " + appInfo.vendor + " " + appInfo.name + " " + appInfo.version +
                         " (Gecko " + appInfo.platformVersion + " / " + appInfo.platformBuildID + ")";
            outputMsg += "\nOS: " + httpService.oscpu + " (" + appInfo.OS + " " + appInfo.XPCOMABI + " " + appInfo.widgetToolkit + ")";
            outputMsg += "\nLOCALE: " + Sixornot.locale.content + " content / " + Sixornot.locale.UI + " UI / " + Sixornot.locale.OS + " OS";

            outputMsg += "\n------------------------------------------------------------\n" +
                         "\nSelect and copy the error report above. In order to fix this problem for you and others, please read and follow the " +
                         "troubleshooting and bug reporting instructions on the Sixornot support forums. Please post an abundance of information with any " +
                         "error reports, namely what you were doing at the time that may have triggered this. (English please)\n";

            var flags = promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_IS_STRING +
                        promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_IS_STRING +
                        promptService.BUTTON_POS_0_DEFAULT;
            var button = promptService.confirmEx( null, "Sixornot Error!", outputMsg, flags, "Go To Support Forums", "Ignore", "", null, {} );

            if (button == 0)  // "Forums" button
            {
                // Open forum in new tab (can't open new window; if error is on startup, we could hit another error)
                Sixornot.addTabInCurrentBrowser("http://sixornot.net/reportingbugs");
            }
        }
        catch (e) { Components.utils.reportError("EXCEPTION DURING FLAGFOX ERROR REPORTING: " + parseException(e)); }
    },

    /* openURL : function(window,url)  // Open URL in a window based on the user's pref
    {
        try
        {
            var openPref = prefService.getCharPref("flagfox.openlinksin");
            if (openPref == "tabBG" || openPref == "tabFG")
            {
                var browser = window.getBrowser();
                try { window.TreeStyleTabService.readyToOpenChildTab(browser.selectedTab); } catch (e) {}  // Support for Tree Style Tab extension
                if (versionComparator.compare(appInfo.platformVersion,"1.9.2") >= 0)
                    var newTab = browser.addTab(url, {ownerTab:browser.selectedTab, relatedToCurrent:true});  // Add tab as child in Firefox 3.6+
                else
                    var newTab = browser.addTab(url, null, null, null, browser.selectedTab);  // Firefox 3.5 & SeaMonkey 2.0 (TODO: drop with dropped Gecko 1.9.1 support)
                if (openPref == "tabFG")
                    browser.selectedTab = newTab;
            }
            else if (openPref == "currentTab")
            {
                window.content.document.location = url;
            }
            else  // "winBG" || "winFG"
            {
                var newWindow = window.open(url,"_blank");
                if (openPref == "winBG")
                {
                    newWindow.blur();
                    window.focus();
                }
            }
        } catch (e) { Flagfox.error("Failed to open URL: "+url,e); }
    }, */

    /* addTabInCurrentBrowser : function(url)  // Add tab to most recent window, regardless of where this function was called from
    {
        var currentWindow = getCurrentWindow();
        currentWindow.focus();
        var currentBrowser = currentWindow.getBrowser();
        currentBrowser.selectedTab = currentBrowser.addTab(url,null,null);
    }, */

    locale :
    {
        get content()  // Firefox primary content locale (user set)
        {
            try
            {
                try { var accept_languages = prefService.getComplexValue("intl.accept_languages",Components.interfaces.nsIPrefLocalizedString).data; }
                catch (e) { var accept_languages = prefService.getCharPref("intl.accept_languages"); }
                return cleanLocaleCode( /^[^\s,;]{2,}/.exec(accept_languages)[0] );  // Extract first locale code in pref (space/comma/semicolon delimited list)
            } catch (e) { return "en"; }
        },
        get UI()  // Sixornot UI locale
        {
            return cleanLocaleCode( Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                                              .getService(Components.interfaces.nsIXULChromeRegistry)
                                              .getSelectedLocale("sixornot") );
        },
        get OS()  // Main OS locale
        {
            return cleanLocaleCode( Components.classes["@mozilla.org/intl/nslocaleservice;1"]
                                              .getService(Components.interfaces.nsILocaleService)
                                              .getSystemLocale()
                                              .getCategory("NSILOCALE_MESSAGES") );
        }
    },

    get strings() { return strings; },
    get helpstrings() { return helpstrings; },
    get countrynames() { return countrynames; },

    get version() { return SixornotVersion; }
};

//// Flag icon instance closure (one per window) ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function newIconInstance(window)
{
    var contentDoc = null;     // Reference to the current page document object
    var url = "";              // The URL of the current page
    var urlIsPortable = true;  // Is the URL not on this computer?
    var host = "";             // The host name of the current URL
    var ipv4s = [];               // The IP addresses of the current host
    var ipv6s = [];               // The IP addresses of the current host
    var usingv6 = null;         // True if we can connect to the site using IPv6, false otherwise

    var icon = window.document.getElementById("sixornot-icon");
//    var menu = window.document.getElementById("sixornot-menu");
    var tooltip = window.document.getElementById("sixornot-tooltip");
//    if (!icon || !menu || !tooltip)
    if (!icon || !tooltip)
    {
        logErrorMessage("Sixornot warning: attempted to load into an invalid window");
        return;
    }
    consoleService.logStringMessage("Sixornot - loading into valid window");

//    var menuContentAge = 0;
    var specialLocation = null;
    var DNSrequest = null;
    var prefListener = new PrefListener("sixornot.",onPrefChange);
    var pollLoopID = window.setInterval(pollForContentChange,250);

    // Go-go gadget events
//    icon.addEventListener("click",onIconClick,false);
//    icon.addEventListener("mousedown",onIconMouseDown,false);
//    icon.addEventListener("mouseover",onIconHover,false);
//    menu.addEventListener("command",onMenuCommand,false);
//    menu.addEventListener("popupshowing",onMenuShowing,false);
    tooltip.addEventListener("popupshowing",updateTooltipContent,false);
//    window.addEventListener("keypress",onKeyPressed,false);
    window.addEventListener("online",onChangedOnlineStatus,false);
    window.addEventListener("offline",onChangedOnlineStatus,false);
    window.addEventListener("unload",unload,false);

    function unload()
    {
        window.removeEventListener("unload",unload,false);
        window.removeEventListener("offline",onChangedOnlineStatus,false);
        window.removeEventListener("online",onChangedOnlineStatus,false);
//        window.removeEventListener("keypress",onKeyPressed,false);
        tooltip.removeEventListener("popupshowing",updateTooltipContent,false);
//        menu.removeEventListener("popupshowing",onMenuShowing,false);
//        menu.removeEventListener("command",onMenuCommand,false);
//        icon.removeEventListener("mouseover",onIconHover,false);
//        icon.removeEventListener("mousedown",onIconMouseDown,false);
//        icon.removeEventListener("click",onIconClick,false);
        window.clearInterval(pollLoopID);
        DnsHandler.cancelRequest(DNSrequest);
        prefListener.unregister();
        tooltip = null;
//        menu = null;
        icon = null;
//        metaTags = null;
        contentDoc = null;
    }

    function pollForContentChange()  // Polling instead of event based to make sure it updates on every page (including error pages)
    {
        try
        {
            if (contentDoc != window.content.document)
                updateState();
        }
        catch (e)
        {
            Components.utils.reportError("Sixornot EXCEPTION: " + parseException(e));
        }
    }

    function updateState()
    {
        if (!ready)  // Startup not finished; wait...
        {
            if (ready === null)  // If aborted, unload
                unload();
            return;
        }

        contentDoc = window.content.document;
        url = contentDoc.location.href;
        urlIsPortable = true;
        host = "";
        ipv6s = [];
        ipv4s = [];

        // If we've changed pages before completing a lookup, then abort the old request first
        DnsHandler.cancelRequest(DNSrequest);
        DNSrequest = null;

        // Tries to update icon based on protocol type (e.g. for local pages which don't need to be looked up)
        // If this fails returns false and we need to do lookup
        if (updateIcon())
            return;

        // Need to look up host
        try { host = contentDoc.location.hostname.cropTrailingChar("."); } catch (e) {}
        if (host == "")
        {
            icon.src = getIconPath("sixornot_button_none_256");
            specialLocation = ["unknownsite"];
            logErrorMessage("Sixornot warning: no host returned for \"" + url + "\"");
            return;
        }

        if (!window.navigator.onLine)
        {
            icon.src = getIconPath("sixornot_button_none_256");
            specialLocation = ["offlinemode"];
            consoleService.logStringMessage("Sixornot is in offline mode");
            return;  // Offline mode or otherwise not connected
        }

        if (DnsHandler.isProxiedDNS(url))
        {
            icon.src = getIconPath("sixornot_button_none_256");
            specialLocation = ["nodnserror"];
            consoleService.logStringMessage("Sixornot is in proxied mode");
            Sixornot.warning(window, "sixornot.warn.proxy", strings.GetStringFromName("proxywarnmessage"));
            return;  // Proxy in use for DNS; can't do a DNS lookup
        }

        // Ideally just hitting the DNS cache here
        DNSrequest = DnsHandler.resolveHost(host, onReturnedIPs);

        function onReturnedIPs(returnedIPs)
        {
            DNSrequest = null;  // Request complete

            // This needs to iterate over the set of IP addresses to check whether each one is IPv4 or IPv6
            // Icon colour depends only on whether the site has:
            // a) IPv4 only - Red
            // b) IPv4 and IPv6 - Green
            // c) IPv6 only - Blue
            // Additionally, if we are connecting over IPv6 to the end site (need some way to determine this!)
            // then case b is split:
            // b.1) IPv4 and IPv6, connecting over IPv6 - Green
            // b.2) IPv4 and IPv6, connecting over IPv4 - Orange 
            // Everything else will display a grey icon of some kind to indicate no IP addresses are involved

            if (returnedIPs[0] == "FAIL")
            {
                icon.src = getIconPath("sixornot_button_none_256");
                specialLocation = ["lookuperror"];
                return;  // DNS lookup failed (ip/countryCode/tldCountryCode stay empty)
            }


            function sixorfour(element, index, array) {
                if (element.indexOf(":") != -1)
                {
                    ipv6s.push(element);
                }
                else
                {
                    ipv4s.push(element);
                }
            }

            returnedIPs.forEach(sixorfour);

            consoleService.logStringMessage("Sixornot - found IP addresses");

            // This must now work as we have a valid IP address
            updateIcon();
        }
    }

    /* Update the status icon state (icon & tooltip)
       Returns true if it's done and false if unknown */
    function updateIcon()
    {
        switch (contentDoc.location.protocol)
        {
            case "file:":
                urlIsPortable = false;
                icon.src = getIconPath("sixornot_button_none_256");
                specialLocation = ["localfile"];
                return true;

            case "data:":
                icon.src = getIconPath("sixornot_button_none_256");
                specialLocation = ["datauri", url.truncateBeforeFirstChar(",")];
                return true;

            case "about:":
                urlIsPortable = false;
                if (url == "about:blank")  // Blank page gets its own icon and tooltip
                {
                    icon.src = getIconPath("sixornot_button_none_256");
                    specialLocation = ["blankpage"];
                }
                else
                {
                    icon.src = getIconPath("sixornot_button_none_256");
                    specialLocation = ["internalfile", url.truncateBeforeFirstChar("?")];
                }
                return true;

            case "chrome:":  case "resource:":
                urlIsPortable = false;
                icon.src = getIconPath("sizornot_button_none_256");
                specialLocation = ["internalfile", contentDoc.location.protocol + "//"];
                return true;

            case "view-source:":  // TODO: handle better
                urlIsPortable = false;
            default:
                if (host == "")
                    return false;  // Unknown host -> still need to look up
                
                if (ipv6s.length == 0)
                {
                    // We only have IPv4 addresses for the website
                    if (ipv4s.length == 0)
                    {
                        // No addresses at all, question mark icon
                        icon.src = getIconPath("sixornot_button_none_256");
                    }
                    else
                    {
                        // v4 only icon
                        icon.src = getIconPath("sixornot_button_ipv4_256");
                    }
                }
                else
                {
                    // We have at least one IPv6 address
                    if (ipv4s.length == 0)
                    {
                        // We only have IPv6 addresses, v6 only icon
                        icon.src = getIconPath("sixornot_button_v6only_256");
                    }
                    else
                    {
                        // v6 and v4 addresses, display green icon (or orange when connection check implemented)
                        // If we can connect to this site using IPv6, display green
                        // If we cannot, display orange
                        icon.src = getIconPath("sixornot_button_using6_256");
                    }
                }
                specialLocation = null;
                return true;
        }
    }

    function updateTooltipContent()
    {
        while (tooltip.firstChild)  // Clear previously generated tooltip, if one exists
            tooltip.removeChild(tooltip.firstChild);

        var grid = window.document.createElement("grid");
        var rows = window.document.createElement("rows");

        var first4 = true;
        var first6 = true;

        function addLabeledLine(labelName, lineValue)
        {
            var row = window.document.createElement("row");
            var label = window.document.createElement("label");
            label.setAttribute("value", labelName);
            label.setAttribute("style", "font-weight: bold;");
            var value = window.document.createElement("label");
            value.setAttribute("value", lineValue);
            row.appendChild(label);
            row.appendChild(value);
            rows.appendChild(row);
        }

        function addUnLabeledLine(lineValue)
        {
            var row = window.document.createElement("row");
            var label = window.document.createElement("label");
//            label.setAttribute("value", "");
            var value = window.document.createElement("label");
            value.setAttribute("value", lineValue);
            row.appendChild(label);
            row.appendChild(value);
            rows.appendChild(row);
        }

        function ip4element(element, index, array) {
            if (first4)
            {
                if (ipv4s.length == 1)
                {
                    addLabeledLine("IPv4 address:", element);
                }
                else
                {
                    addLabeledLine("IPv4 addresses:", element);
                }
                first4 = false;
            }
            else
            {
                addUnLabeledLine(element);
            }
        }
        function ip6element(element, index, array) {
            if (first6)
            {
                if (ipv6s.length == 1)
                {
                    addLabeledLine("IPv6 address:", element);
                }
                else
                {
                    addLabeledLine("IPv6 addresses:", element);
                }
                first6 = false;
            }
            else
            {
                addUnLabeledLine(element);
            }
        }

        if (host != "")
            addLabeledLine("Domain name:", host);
        if (ipv4s != [])
            ipv4s.forEach(ip4element);
        if (ipv6s != [])
            ipv6s.forEach(ip6element);

        if (specialLocation)
        {
            var extraString
            switch (specialLocation[0])
            {
                case "unknownsite":
                    extraString = "Unknown site"
                case "blankpage":
                    extraString = "Blank page"
                case "internalfile":
                    extraString = "Internal file"
                case "localfile":
                    extraString = "Local file"
                case "datauri":
                    extraString = "Data URI"
                case "lookuperror":
                    extraString = "Lookup error"
                case "nodnserror":
                    extraString = "No local DNS access"
                case "offlinemode":
                    extraString = "Offline mode"
            }

            if (specialLocation[1])
                extraString += " (" + specialLocation[1] + ")";
            var extraLine = window.document.createElement("label");
            extraLine.setAttribute("value", extraString);
            if (["unknownsite","lookuperror","nodnserror","offlinemode"].indexOf(specialLocation[0]) != -1)
                extraLine.setAttribute("style", "font-style: italic;");
            rows.appendChild(extraLine);
        }

        grid.appendChild(rows);
        tooltip.appendChild(grid);
    }

/*    function updateMenuContent()  // Update actions in context menu based on current prefs
    {
        if (menuContentAge == actionsListAge)  // Only generate if this window's menu is stale
            return;

        Flagfox.actions.assertLoaded();

        var showAllItems = (menuContentAge == -1);  // Set menu age to -1 to show everything at once, regardless of show setting

        var showFavicons = safeGetBoolPref("flagfox.showfavicons");

        while (menu.firstChild)  // Clear previously generated menu, if one exists
            menu.removeChild(menu.firstChild);

        function newMenuItem(value,label)
        {
            var newElement = window.document.createElement("menuitem");
            newElement.setAttribute("value", value);
            newElement.setAttribute("label", label);
            menu.appendChild(newElement);
            return newElement;
        }

        function newMenuItemForAction(action,id)
        {
            if ( !(action.show || showAllItems) )
                return;

            var newElement = newMenuItem(id, Flagfox.actions.getLocalizedName(action));

            if (showFavicons)
            {
                newElement.setAttribute("class", "menuitem-iconic");  // Allow icon
                newElement.setAttribute("validate", "never");  // Force usage of cache
                newElement.setAttribute("onerror", "this.image='chrome://mozapps/skin/places/defaultFavicon.png';");
                newElement.setAttribute("image", Flagfox.getFaviconForTemplate(action.template));
            }
        }

        // Generate actions list
        for (var i in actionsList)
            newMenuItemForAction(actionsList[i], i);

        menu.appendChild(window.document.createElement("menuseparator"));

        // Add "Options"
        newMenuItem("options", strings.GetStringFromName("options"));

        if (showAllItems)
            menuContentAge = 0;  // All were shown; reset for next open
        else
            menuContentAge = actionsListAge;  // Menu content synced to actions list
    } */

/*    function isActionAllowed(id)  // Is the given action allowed for this current state?
    {
        if (id === undefined || id === null)  // The id may be 0
            return false;

        if (id == "options")
            return true;

        if (!contentDoc)
            return false;

        var action = actionsList[id];
        Flagfox.actions.assertValid(action);
        var template = action.template;

        function needs(placeholder) { return RegExp(placeholder,"i").test(template); }  // Case-insensitive regexp search for placeholder in template

        switch (template.truncateBeforeFirstChar(":"))
        {
            default:
                if (!window.navigator.onLine)
                    return false;
                if (!urlIsPortable)
                {
                    if ( needs("{fullURL}") )  // Don't send local URLs to remote lookups
                        return false;
                    if ( (host == ip || host == "localhost") && needs("{(IPaddress|(base)?domainName|TLD)}") )  // Don't send local IPs without hostnames to remote lookups
                        return false;
                }
                break;

            case "copystring":
                break;  // Nothing special needed (as apposed to "default:")

            case "javascript":
                if (!contentDoc.defaultView)
                    return false;
                break;
        }

        if ( host == "" && needs("{((base)?domainName|TLD)}") )
            return false;
        if ( ip == "" && needs("{IPaddress}") && !needs("{((base)?domainName|TLD)}") )  // Allow optional IP when also using host (i.e. Geotool behind a proxy)
            return false;
        if ( !countryCode && needs("{country(Code|Name)}") )
            return false;

        return true;
    } */

/*    function doAction(id)
    {
        if (!isActionAllowed(id))
            return;

        if (id == "options")
        {
            // Flags from Add-ons Manager + resizable; focus() after open to refocus already open window, if needed
            window.openDialog("chrome://flagfox/content/options.xul", "FlagfoxOptions", "chrome,titlebar,toolbar,centerscreen,resizable").focus();
            return;
        }

        var action = actionsList[id];

        switch (action.template.truncateBeforeFirstChar(":"))
        {
            default:  // Lookup URL action
                if (action.template.substr(0,23) == "http://geo.flagfox.net/")  // Identify this Flagfox version to Geotool for abuse prevention purposes
                    setGeotoolCookie();
                var parsedTemplate = parseTemplate(action.template, "url");  // Parse template as URL
                Flagfox.openURL(window, parsedTemplate);
                return;

            case "copystring":  // Copy to clipboard action uses an ad hoc pseudo-protocol
                var parsedTemplate = parseTemplate(action.template.slice(11), "none");  // Parse template after "copystring:"
                clipboardHelper.copyString(parsedTemplate);
                return;

            case "javascript":  // Javascript action; evaluate in sandbox instead of evaluating as a URL
                var parsedTemplate = parseTemplate(action.template.slice(11), "escapequotes");  // Parse template after "javascript:" and escape any quotes

                var contentWindow = contentDoc.defaultView;
                var sandbox = Components.utils.Sandbox(contentWindow);
                sandbox.window = contentWindow;  // Sandbox has access to content window object (not chrome window!)

                // Override window object prompts using this action's name in the title (linked to content window)
                const actionName = Flagfox.actions.getLocalizedName(action);
                const dialogTitle = actionName + " - Flagfox";
                sandbox.prompts = {
                    alert : function(msg) { promptService.alert(contentWindow,dialogTitle,msg); },
                    confirm : function(msg) { return promptService.confirm(contentWindow,dialogTitle,msg); },
                    prompt : function(msg,val) { return promptService.prompt(contentWindow,dialogTitle,msg,val); }
                };

                sandbox.importFunction(function(newurl) { Flagfox.openURL(window,newurl); }, "openURL");         // API to open a URL via method set by user pref
                sandbox.importFunction(function(string) { clipboardHelper.copyString(string); }, "copystring");  // API to copy a string to the clipboard
                sandbox.importFunction(function(logmsg) { consoleService.logStringMessage(logmsg); }, "log");    // API to log a string message to the Error Console

                try
                {
                    // Allow direct access to content window methods/properties as if this action were running in the content
                    // prompts' methods override window's locally (e.g. alert=prompts.alert but window.alert still exists)
                    const JStoEval = "with (window) with (prompts) {\n" + parsedTemplate + "\n}";
                    Components.utils.evalInSandbox(JStoEval, sandbox);
                }
                catch (e)  // Handle exceptions in JavaScript actions with a user friendly error popup and Error Console message
                {
                    var errorMsg = e.toString();
                    if (e.stack)
                    {
                        var cleanStack = e.stack.replace(/@.*\n/g,"\n").trimRight();
                        if (/\n/.test(cleanStack))  // Only show if more than one line
                            errorMsg += "\n\nstack trace:\n" + cleanStack;
                    }
                    errorMsg += "\n\naction source:\n" + parsedTemplate;
                    var errorTitle = "Flagfox JavaScript Action \"" + actionName + "\" ERROR";
                    logErrorMessage(errorTitle + ":\n\n" + errorMsg);
                    promptService.alert(contentWindow, errorTitle, errorMsg);
                }
                return;
        }
    } */

/*    function parseTemplate(template,encoding)  // Placeholders in templates are case-insensitive and may be used multiple times
    {
        function getReplacement(token) { return getParameterValue(token,template,encoding); }

        if (encoding == "url")
        {
            // Both the full template and parameters need encoding but I can't do encodeURI() with the parameters as that
            // ignores certain characters that might cause problems with searches. The parameters need encodeURIComponent().
            // To prevent double encoding I do encodeURI() first and simply search using encoded placeholders. 
            return encodeURI(template).replace(/%7B[^%\s]+%7D/g, getReplacement);
        }
        else
        {
            return template.replace(/\{[^{}\s]+\}/g, getReplacement);
        }
    } */

/*    function getParameterValue(token,template,encoding)
    {
        var parameter, maybeEncode;
        switch (encoding)
        {
            default:
            case "none":
                parameter = token.slice(1,-1);  // Cut off { & }
                maybeEncode = function(a) { return a; };
                break;

            case "url":
                parameter = token.slice(3,-3);  // Cut off %7B & %7D
                maybeEncode = encodeURIComponent;
                break;

            case "escapequotes":
                parameter = token.slice(1,-1);
                maybeEncode = function(str) { return String(str).replace(/\\/g,"\\\\").replace(/\'/g,"\\\'").replace(/\"/g,"\\\""); };
                break;
        }
        parameter = parameter.toLowerCase().split('-');  // Split into components if available (left/right side of '-')
        switch (parameter[0])
        {
            case "fullurl":
                if (encoding == "url")  // Some templates will need the URL variable to be encoded and others will need it to not be
                {
                    var charBeforeURL = template[ template.search(/\{fullURL\}/i) - 1 ];
                    if (charBeforeURL == '=' || charBeforeURL == ':')
                        return encodeURIComponent(url);
                }
                return url;

            case "basedomainname":
                try { return maybeEncode(tldService.getBaseDomainFromHost(host)); }
                catch (e) {}  // Throws if something is wrong with host name or is IP address; fall-through and use full host name

            case "domainname":
                return maybeEncode(host);

            case "tld":
                try { return maybeEncode(tldService.getPublicSuffixFromHost(host)); }
                catch (e) { return maybeEncode(host.truncateAfterLastChar(".")); }

            case "ipaddress":
                return maybeEncode(ip);

            case "countrycode":
                return countryCode;  // Always two ASCII characters; never needs encoding

            case "countryname":
                return maybeEncode(countrynames.GetStringFromName(countryCode));

            case "title":
                return maybeEncode(contentDoc.title);

            case "baselocale":
                var base = true;  // language-dialect -> language
            case "locale":
                var locale;
                switch (parameter[1])
                {
                    default:      locale = Flagfox.locale.content;           break;  // {locale}      -> primary user requested content locale
                    case "ui":    locale = Flagfox.locale.UI;                break;  // {locale-ui}   -> Flagfox UI strings locale (e.g. country names)
                    case "os":    locale = Flagfox.locale.OS;                break;  // {locale-os}   -> native operating system locale
                    case "page":  locale = contentDoc.documentElement.lang;  break;  // {locale-page} -> locale stated for the current page (empty string if none)
                }
                return maybeEncode( base ? locale.split('-')[0] : locale );  // Shouldn't need encoding, but do so if needed just in case of a bogus value in content

            case "meta":
                // Unfortunately contentDoc.querySelector is case-sensitive and HTML in the wild is messy, so search manually
                if (!metaTags)  // Cached?
                    metaTags = contentDoc.getElementsByTagName("meta");  // case-insensitive tag search
                for (var i=0; i < metaTags.length; i++)
                    if (parameter[1] == metaTags[i].name.toLowerCase())  // case-insensitive name search
                        return maybeEncode(metaTags[i].content);
                return "";  // Meta tags are optional and vary, thus they're always allowed placeholders; return empty string if no matched name

            default:
                return token;  // Don't know what it is; leave it alone
        }
    } */

    function onPrefChange(branch,prefName)
    {
        switch (prefName)
        {
            case "usealticons":
                updateState();
                return;
        }
    }

    function onIconClick(event)
    {
        function doClickAction()
        {
            if (event.button == 1 || (event.button == 0 && event.ctrlKey))  // Middle or Left+Ctrl
                var binding = "middleclick";
            else if (event.button == 0)  // Left
                var binding = "click";
            else
                return;
            // Button 2 (Right) shows popup menu via context attribute

            // event.detail for click events is the number of successive clicks thus far
            if (event.detail == 2)
                binding = "double" + binding;
            else if (event.detail == 3)
                binding = "triple" + binding;

            doAction(hotClicks[binding]);
        }

        /* There is a dblclick event, but I can't use that because it's sent out in addition to two click events,
           not instead of. As a result, I just use the click event and detect multiple clicks within a short timeframe.
           (which also allows for triple click detection) The time has to be very short, otherwise when a user does a
           single click action it will still have to wait a while to see if there's going to be a second click. */
        window.clearTimeout(this.clicktimer);
        this.clicktimer = window.setTimeout(doClickAction, 250);
        // Double click = two clicks within 250ms; Triple click = three clicks within 500ms
    }

    function onIconMouseDown(event)  // Handle keyboard modifiers when right-clicking on the icon
    {
        if (event.button == 2 && event.ctrlKey)  // Right+Ctrl
            menuContentAge = -1;  // Show all items at once
    }

    function onIconHover(event)  // Changes mouseover cursor to a hand when there is a click action
    {
        icon.style.cursor = isActionAllowed(hotClicks["click"]) ? "pointer" : "default" ;
    }

/*    function onMenuCommand(event)
    {
        var actionID = event.target.value;
        doAction(actionID);
    }

    function onMenuShowing(event)
    {
        updateMenuContent();  // Update menu, if need be

        var menuItems = menu.getElementsByTagName("menuitem");
        for (var i=0; i < menuItems.length; i++)  // Decide which menu items to grey out if they aren't available
            menuItems[i].setAttribute("disabled", !isActionAllowed( menuItems[i].getAttribute("value") ));  // Need to use attributes here
    } */

    /* Listening to every keypress here because dynamically adding to a <keyset> with <keys> being listened to doesn't seem to work well.
       This function only takes around a microsecond or less to run so it shouldn't affect performance.
       event.charCode is case-sensitive so I don't need to check for shift separately. */
/*    function onKeyPressed(event)
    {
        if (event.ctrlKey || event.altKey || event.metaKey)
        {
            var boundKey = hotKeys[event.charCode];
            if (boundKey)
                doAction( boundKey[getModsCode(event.ctrlKey,event.altKey,event.metaKey)] );
        }
    } */

    /* The "online" and "offline" events fire many times at once on the window object.
       To avoid redundant updates I just reset things and let it update on the next poll.
       In case the menu was opened offline it's reset too to make sure favicons are loaded. */
    function onChangedOnlineStatus(event)
    {
        contentDoc = null;
        menuContentAge = 0;
    }
}

//// DNS handler (does lookups for IP addresses) ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var DnsHandler =
{
    isProxiedDNS : function(url)  // Returns true if the URL is set to have its DNS lookup proxied via SOCKS
    {
        var uri = ioService.newURI(url, null, null);
        var proxyinfo = proxyService.resolve(uri, 0);  // Finds proxy (shouldn't block thread; we already did this lookup to load the page)
        return (proxyinfo != null) && (proxyinfo.flags & proxyinfo.TRANSPARENT_PROXY_RESOLVES_HOST);
        // "network.proxy.socks_remote_dns" pref must be set to true for Firefox to set TRANSPARENT_PROXY_RESOLVES_HOST flag when applicable
    },

    cancelRequest : function(request)
    {
        try { request.cancel(Components.results.NS_ERROR_ABORT); } catch(e) {}  // calls onLookupComplete() with status=Components.results.NS_ERROR_ABORT
    },

    resolveHost : function(host,returnIP)  // Returns request object
    {
        function fail(reason)
        {
            logErrorMessage("Sixornot warning: DNS lookup failure for \"" + host + "\": " + reason);
            returnIP(["FAIL"]);
        }

        var callback =
        {
            onLookupComplete : function(nsrequest, nsrecord, status)
            {
                if (status == Components.results.NS_ERROR_ABORT)
                    return;  // Ignore cancel

                if (status != 0 || !nsrecord || !nsrecord.hasMore())
                {
                    fail( (status==Components.results.NS_ERROR_UNKNOWN_HOST) ? ("Unknown host") : ("status " + status) );
                    return;  // IP not found in DNS
                }

                var IPAddresses = [];
                while (nsrecord.hasMore())
                {
                    IPAddresses.push(nsrecord.getNextAddrAsString());
                }

                // Needs to be changed to return all the IPs, not just one of them (as an array? how does that affect returnIP?)
//                returnIP(nsrecord.getNextAddrAsString());
                returnIP(IPAddresses)
            }
        };

        try
        {
            return dnsService.asyncResolve(host, 0, callback, threadManager.currentThread);
        }
        catch (e)
        {
            fail( "exception " + ((e.name && e.name.length) ? e.name : e) );
            return null;
        }
    }
};

//// Utility functions //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function getIconPath(filename)
{
    return "resource://sixornot/skin/icons/" + filename + ".png";
}

function PrefListener(branchName, onChanged)
{
    var branch = prefService.getBranch(branchName);
    branch.QueryInterface(Components.interfaces.nsIPrefBranch2);
    branch.addObserver("", this, false);

    this.unregister = function()
    {
        if (branch)
            branch.removeObserver("", this);
        branch = null;
    };

    this.observe = function(subject, topic, data)
    {
        if (topic == "nsPref:changed")
            onChanged(branch, data);
    };
}

function doOnShutdown(onShutdown)
{
    var observerService = Components.classes["@mozilla.org/observer-service;1"]
                                    .getService(Components.interfaces.nsIObserverService);
    var quitEventObserver =
    {
        observe : function(subject, topic, data)
        {
            if (topic != "quit-application")
                return;
            try { onShutdown(); }
            finally { observerService.removeObserver(quitEventObserver, "quit-application"); }
        }
    };
    observerService.addObserver(quitEventObserver, "quit-application", false);
}

function hashString(string)  // Returns a base-64 encoded MD5 hash of a Unicode string
{
    var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                              .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    var bytes = converter.convertToByteArray(string,{});
    var cryptoHash = Components.classes["@mozilla.org/security/hash;1"]
                               .createInstance(Components.interfaces.nsICryptoHash);
    cryptoHash.init(cryptoHash.MD5);
    cryptoHash.update(bytes,bytes.length);
    return cryptoHash.finish(true);
}

function getModsCode(ctrl,alt,meta)  // Convert boolean triplet into an integer
{
    var code = 0;
    if (ctrl)
        code |= 1;
    if (alt)
        code |= 2;
    if (meta)
        code |= 4;
    return code;
}

function getCurrentWindow()
{
    return Components.classes["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Components.interfaces.nsIWindowMediator)
                     .getMostRecentWindow("navigator:browser");
}

function logErrorMessage(message)  // Logs a string message to the error console with no file link, similar to consoleService.logStringMessage(), but with "error" status
{
    var scriptError = Components.classes["@mozilla.org/scripterror;1"]
                                .createInstance(Components.interfaces.nsIScriptError);
    scriptError.init(message,null,null,null,null,0,null);
    consoleService.logMessage(scriptError);
}

function parseException(e)  // Returns a string version of an exception object with its stack trace
{
    if (!e)
        return "";
    else if (!e.stack)
        return String(e);
    else
        return String(e) + " \n" + cleanExceptionStack(e.stack);
}

/* For some stupid reason any resource:// URLs are converted into full file:// URL paths in exception stacks.
   This function converts them back to make the stack shorter and more readable.
   TODO: Someday use chrome:// loaded JSM and not need this (Gecko 2.0+ only) */
function cleanExceptionStack(stack)
{
    try
    {
        const shortPath = "resource://sixornot/";
        const longPath = ioService.newChannel(shortPath,null,null).URI.spec;
        return stack.replace(new RegExp(longPath,"ig"), shortPath);
    }
    catch (e)
    {
        return stack;
    }
}

function cleanLocaleCode(code)  // Cleans a locale code to use a consistent format (lowercase is needed in a few places)
{
    return String(code).replace('_','-').toLowerCase();
}
/*
function showPageOnceEver(url,pref)  // Will show the given URL in a new tab, only once ever, and use the given pref to remember
{
    if (!safeGetBoolPref(pref))
    {
        getCurrentWindow().setTimeout(function(){
            Flagfox.addTabInCurrentBrowser(url);
            prefService.setBoolPref(pref,true);
        }, 1000);  // Need a delay to make sure it's shown after an update under Firefox 3.6+ for some reason
    }
}
*/
function getPrefsDump(branchname)
{
    var branch = prefService.getBranch(branchname);
    var prefList = branch.getChildList("",{});
    prefList.sort();
    var output = [];
    for (var i in prefList)
        output.push(branchname + prefList[i] + "=" + getGenericPref(branch,prefList[i]));
    if (!output.length)
        throw "Prefs list is EMPTY!"
    return output.join("\n");
}

function getGenericPref(branch,prefName)  // Get any pref from a branch, even if you don't know its type
{
    switch (branch.getPrefType(prefName))
    {
        case 0:   return "(INVALID!)";                   // PREF_INVALID
        case 32:  return getUCharPref(branch,prefName);  // PREF_STRING
        case 64:  return branch.getIntPref(prefName);    // PREF_INT
        case 128: return branch.getBoolPref(prefName);   // PREF_BOOL
    }
    throw Error("Bad pref type for: " + prefName);
}

function getUCharPref(branch,prefName)  // Unicode getCharPref
{
    return branch.getComplexValue(prefName, Components.interfaces.nsISupportsString).data;
}

function setUCharPref(branch,prefName,text)  // Unicode setCharPref
{
    var string = Components.classes["@mozilla.org/supports-string;1"]
                           .createInstance(Components.interfaces.nsISupportsString);
    string.data = text;
    branch.setComplexValue(prefName, Components.interfaces.nsISupportsString, string);
}

function safeGetBoolPref(pref)  // Returns bool pref value, or false if there's an error or it does not exist
{
    try { return prefService.getBoolPref(pref); }
    catch (e) { return false; }
}

String.prototype.cropTrailingChar = function(character)  // This does NOT get exposed out of the scope of this JSM file
{
    return (this.charAt(this.length-1)==character) ? this.slice(0,this.length-1) : this.valueOf();
};

String.prototype.truncateAfterLastChar = function(character)  // This does NOT get exposed out of the scope of this JSM file
{
    let pos = this.lastIndexOf(character);
    return (pos != -1) ? this.substring(pos+1) : this.valueOf();
};

String.prototype.truncateBeforeFirstChar = function(character)  // This does NOT get exposed out of the scope of this JSM file
{
    let pos = this.indexOf(character);
    return (pos != -1) ? this.substring(0,pos) : this.valueOf();
};

//// Services & Strings (each fetched once on first use) ////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function defineLazyGetter(getterName, getterFunction)
{
    this.__defineGetter__(getterName, function() {
        delete this[getterName];
        return this[getterName] = getterFunction.apply(this);
    });
}

defineLazyGetter("prefService", function() {
    return Components.classes["@mozilla.org/preferences-service;1"]
                     .getService(Components.interfaces.nsIPrefBranch)
                     .QueryInterface(Components.interfaces.nsIPrefService);
});
defineLazyGetter("ioService", function() {
    return Components.classes["@mozilla.org/network/io-service;1"]
                     .getService(Components.interfaces.nsIIOService);
});
defineLazyGetter("threadManager", function() {
    return Components.classes["@mozilla.org/thread-manager;1"]
                     .getService(Components.interfaces.nsIThreadManager);
});
defineLazyGetter("dnsService", function() {
    return Components.classes["@mozilla.org/network/dns-service;1"]
                     .getService(Components.interfaces.nsIDNSService);
});
defineLazyGetter("proxyService", function() {
    return Components.classes["@mozilla.org/network/protocol-proxy-service;1"]
                     .getService(Components.interfaces.nsIProtocolProxyService);
});
//defineLazyGetter("tldService", function() {
//    return Components.classes["@mozilla.org/network/effective-tld-service;1"]
//                     .getService(Components.interfaces.nsIEffectiveTLDService);
//});
defineLazyGetter("consoleService", function() {
    return Components.classes["@mozilla.org/consoleservice;1"]
                     .getService(Components.interfaces.nsIConsoleService);
});
defineLazyGetter("promptService", function() {
    return Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                     .getService(Components.interfaces.nsIPromptService);
});
//defineLazyGetter("clipboardHelper", function() {
//    return Components.classes["@mozilla.org/widget/clipboardhelper;1"]
//                     .getService(Components.interfaces.nsIClipboardHelper);
//});
//defineLazyGetter("cookieManager", function() {
//    return Components.classes["@mozilla.org/cookiemanager;1"]
//                     .getService(Components.interfaces.nsICookieManager2);
//});
defineLazyGetter("httpService", function() {
    return Components.classes["@mozilla.org/network/protocol;1?name=http"]
                     .getService(Components.interfaces.nsIHttpProtocolHandler);
});
defineLazyGetter("appInfo", function() {
    return Components.classes["@mozilla.org/xre/app-info;1"]
                     .getService(Components.interfaces.nsIXULAppInfo)
                     .QueryInterface(Components.interfaces.nsIXULRuntime);
});
defineLazyGetter("versionComparator", function() {
    return Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                     .getService(Components.interfaces.nsIVersionComparator);
});

function loadPropertiesFile(path)
{
    var bundle = Components.classes["@mozilla.org/intl/stringbundle;1"]
                           .getService(Components.interfaces.nsIStringBundleService)
                           .createBundle(path);
    if (!bundle || !bundle.getSimpleEnumeration().hasMoreElements())
        throw Error("Could not load string bundle: " + path);
    return bundle;
}

defineLazyGetter("strings", function() {
    return loadPropertiesFile("resource://sixornot/locale/sixornot.properties");
});
defineLazyGetter("helpstrings", function() {
    return loadPropertiesFile("resource://sixornot/locale/help.properties");
});
//defineLazyGetter("countrynames", function() {
//    return loadPropertiesFile("chrome://sixornot/locale/countrynames.properties");
//});
