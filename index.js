// index.js for Top Info Bar plugin
import {
    eventSource,
    event_types,
    getContext,
    characters, // Used indirectly by getCharacterAvatar if needed
    this_chid, // Used by getCurrentCharacterAvatarUrl
    getCharacterAvatar,
    groups, // Used by getCurrentGroupAvatarInfo
    selected_group, // Used by getCurrentGroupAvatarInfo
    getGroupAvatar, // Used by getCurrentGroupAvatarInfo
    // Potentially needed if getCurrentChatName is not self-contained
    // name1, name2, user_avatar, default_avatar etc. might be needed depending on helper functions
} from '../../../../script.js'; // Adjust path if needed

// Assuming getCurrentChatName function is defined elsewhere or implemented here
// Let's implement getCurrentChatName here based on the provided text file
/**
 * 获取当前聊天会话的显示名称。
 * @returns {string | null} 当前聊天的名称或标识符，如果获取失败或无聊天则返回 null。
 */
function getCurrentChatName() {
    try {
        const context = getContext();
        if (!context) {
            log("无法获取 getContext()");
            return null; // Return null instead of error string
        }

        if (context.groupId) { // Check group first
            const currentGroup = groups.find(group => group.id === context.groupId);
            // Use group name, fallback to ID, or null if group not found
            return currentGroup ? currentGroup.name : (context.groupId ? `群组 ${context.groupId}` : null);
        } else if (context.characterId) { // Then check character
            // context.name2 is the character's display name
            return context.name2 || null; // Return null if no name
        } else {
            return null; // No character or group selected
        }
    } catch (error) {
        console.error("[TopInfoBar] 获取聊天名称时出错:", error);
        return null; // Return null on error
    }
}

// Implement getCurrentCharacterAvatarUrl based on the provided text file
/**
 * 获取当前单聊角色头像 URL
 * @returns {string | null} URL string or null
 */
function getCurrentCharacterAvatarUrl() {
    const context = getContext(); // Get fresh context
    if (!context || context.characterId === undefined || !characters[context.characterId]) {
        // console.warn("[TopInfoBar] 没有选中的角色 for avatar"); // Less verbose log
        return null; // No character selected or found
    }
    // Use the provided getCharacterAvatar function
    return getCharacterAvatar(context.characterId);
}

// Implement getCurrentGroupAvatarInfo based on the provided text file
// Adapt based on getGroupAvatar's actual return value (URL vs element)
/**
 * 获取当前群聊头像 URL (best effort)
 * @returns {string | null} URL string or null
 */
function getCurrentGroupAvatarInfo() {
    const context = getContext(); // Get fresh context
    if (!context || !context.groupId) {
        // console.warn("[TopInfoBar] 不在群聊模式下 for avatar"); // Less verbose log
        return null;
    }
    const group = groups.find(g => g.id === context.groupId);
    if (!group) {
        console.warn("[TopInfoBar] 找不到当前群组信息:", context.groupId);
        return null;
    }

    // Strategy:
    // 1. Prefer group.avatar_url if it exists and seems like a URL.
    // 2. Fallback to trying getGroupAvatar and extracting src if it returns an element.
    // 3. Return null otherwise.

    if (group.avatar_url && typeof group.avatar_url === 'string' && group.avatar_url.startsWith('data:image') || group.avatar_url.includes('/')) {
         // Basic check if avatar_url looks like a valid URL or data URI
         return group.avatar_url;
    }

    try {
        // Assuming getGroupAvatar returns a jQuery element
        const groupAvatarElement = getGroupAvatar(group);
        if (groupAvatarElement && typeof groupAvatarElement.find === 'function') {
            const imageUrl = groupAvatarElement.find('img').attr('src');
            if (imageUrl) {
                return imageUrl;
            }
        }
        // If getGroupAvatar doesn't return a usable element/URL, return null
         return null;
    } catch (error) {
        console.error("[TopInfoBar] 获取群组头像时出错 (getGroupAvatar):", error);
        // Fallback to avatar_url again just in case getGroupAvatar failed but URL exists
         return group.avatar_url || null;
    }

}


// --- Plugin Constants and State ---
const extensionName = "top-info-bar"; // Matches the folder name
const collapseHeight = '0px';
const expandHeight = '30px'; // Height when expanded
const originalMenuHeight = '40px'; // Default height of #top-bar etc.
const collapsedMenuHeight = '15px'; // Height of #top-bar when overlay is expanded

// Verify these IDs in your SillyTavern version using Developer Tools (F12)
const topBarSelector = '#top-bar';
const topSettingsHolderSelector = '#top-settings-holder';

const DEBUG = true; // Enable/disable console logs

let isOverlayCollapsed = false; // Is the bar manually collapsed by the user?
let isMonitoringDrawer = false; // Is the MutationObserver active?
let drawerObserver = null;
let drawerWasOpen = false; // State of drawers before the last check
let currentDisplayedId = null; // ID of the character or group currently shown, null if none


// --- Utility Functions ---
function log(...args) {
    if (DEBUG) {
        console.log(`[${extensionName}]`, ...args);
    }
}

// --- DOM Manipulation ---
function createOverlay() {
    if (document.getElementById('top-white-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'top-white-overlay';
    // Initial styles are set by CSS, JS controls dynamic parts (height, opacity)

    const imageContainer = document.createElement('div');
    imageContainer.id = 'overlay-image-container';

    const img = document.createElement('img');
    img.id = 'overlay-image';
    img.src = ''; // Start empty
    imageContainer.appendChild(img);

    const nameContainer = document.createElement('div');
    nameContainer.id = 'overlay-name-container';
    nameContainer.textContent = ''; // Start empty

    overlay.appendChild(imageContainer);
    overlay.appendChild(nameContainer);

    // Click listener for manual collapse/expand
    overlay.addEventListener('click', function(e) {
        toggleOverlayCollapse();
        e.stopPropagation(); // Prevent event bubbling
    });

    document.body.appendChild(overlay);
    log('白色幕布条 DOM 已创建');
}

function adjustTopBarsHeight(collapsed) {
    const topBar = document.querySelector(topBarSelector);
    const topSettingsHolder = document.querySelector(topSettingsHolderSelector);
    const height = collapsed ? collapsedMenuHeight : originalMenuHeight;

    // Add/remove class to body for CSS targeting and state indication
    if(collapsed){
        document.body.classList.add('top-bar-collapsed');
    } else {
        document.body.classList.remove('top-bar-collapsed');
    }

    // Direct style manipulation as fallback or primary method
    if (topBar) topBar.style.height = height;
    if (topSettingsHolder) topSettingsHolder.style.height = height;
    // log('Adjusted top bars height to:', height);
}

async function updateImageAndName() {
    log('尝试更新图片和名称...');
    const overlayImg = document.getElementById('overlay-image');
    const nameContainer = document.getElementById('overlay-name-container');
    if (!overlayImg || !nameContainer) {
         console.error(`[${extensionName}] 无法找到幕布条图片或名称容器！`);
         return;
    }

    const context = getContext();
    let name = null;
    let avatarUrl = null;
    let newId = null;

    if (context.groupId) {
         name = getCurrentChatName(); // Should return group name
         avatarUrl = getCurrentGroupAvatarInfo(); // Should return group avatar URL
         newId = `group-${context.groupId}`; // Prefix to distinguish IDs
    } else if (context.characterId !== undefined) {
        name = getCurrentChatName(); // Should return character name
        avatarUrl = getCurrentCharacterAvatarUrl(); // Should return char avatar URL
        newId = `char-${context.characterId}`; // Prefix to distinguish IDs
    }

    // Use default/placeholder if null? For now, just hide/show based on valid data.
    if (name && avatarUrl) {
        if (nameContainer.textContent !== name) {
            nameContainer.textContent = name;
            log('名称已更新:', name);
        }
        if (overlayImg.src !== avatarUrl) {
            overlayImg.src = avatarUrl;
            log('头像已更新'); // URL can be long, don't log it fully
        }
        currentDisplayedId = newId; // Update the tracked ID
    } else {
        log('未能获取有效的名称或头像，不更新内容。Name:', name, 'Avatar URL:', avatarUrl);
        // Optionally clear content or hide overlay if fetch fails?
        // nameContainer.textContent = '';
        // overlayImg.src = '';
        // currentDisplayedId = null; // Clear tracked ID if update fails
        // hideOverlay(); // Decide if failure should hide the bar
    }
}


// --- Overlay Visibility and State Control ---
function showOverlay() {
    const overlay = document.getElementById('top-white-overlay');
    if (!overlay) {
        log('幕布条 DOM 不存在，无法显示');
        return;
    }

    log('显示幕布条...');
    updateImageAndName(); // Fetch and update content

    // Only make visible if content was successfully updated (or decide otherwise)
    if(currentDisplayedId){
        overlay.classList.add('visible'); // Use class for opacity/pointer-events
        expandOverlay(); // Set initial height and adjust top bars
    } else {
         log('由于未能获取内容，保持幕布条隐藏');
         hideOverlay(); // Ensure it's hidden if content fails
    }

}

function hideOverlay() {
    const overlay = document.getElementById('top-white-overlay');
    if (!overlay) return;

    log('隐藏幕布条...');
    overlay.classList.remove('visible'); // Hide via class
    overlay.style.height = collapseHeight; // Ensure visually hidden immediately
    adjustTopBarsHeight(false); // Restore top bars height
    stopMonitoringDrawer(); // Stop listening for drawer changes
    isOverlayCollapsed = false; // Reset manual collapse state
    currentDisplayedId = null; // Clear the tracked ID

     // Optionally clear the content when hiding
     const overlayImg = document.getElementById('overlay-image');
     const nameContainer = document.getElementById('overlay-name-container');
     if(overlayImg) overlayImg.src = '';
     if(nameContainer) nameContainer.textContent = '';
}

function toggleOverlayCollapse() {
    if (!document.getElementById('top-white-overlay')?.classList.contains('visible')) {
         log('幕布条不可见，无法切换折叠状态');
         return; // Don't toggle if not visible
    }

    if (!isOverlayCollapsed) {
        collapseOverlay();
    } else {
        expandOverlay();
    }
    log('切换折叠状态完成');
}

function collapseOverlay() {
    const overlay = document.getElementById('top-white-overlay');
    if (!overlay || isOverlayCollapsed) return;

    log('手动折叠幕布条');
    overlay.style.height = collapseHeight;
    // Keep opacity 1 via 'visible' class, just change height
    adjustTopBarsHeight(false); // Restore top bars when collapsed
    isOverlayCollapsed = true;
    startMonitoringDrawer(); // Start monitoring drawers ONLY when manually collapsed
}

function expandOverlay() {
    const overlay = document.getElementById('top-white-overlay');
    if (!overlay || !isOverlayCollapsed) {
         // If called when already expanded OR not visible, ensure correct state
         if(overlay?.classList.contains('visible')){
             overlay.style.height = expandHeight;
             adjustTopBarsHeight(true); // Collapse top bars
         }
        // No need to log if already expanded implicitly
         return;
    }


    log('展开幕布条');
    overlay.style.height = expandHeight;
    adjustTopBarsHeight(true); // Collapse top bars
    isOverlayCollapsed = false;
    stopMonitoringDrawer(); // Stop monitoring drawers when expanded
}

// --- Drawer Monitoring (Optimized MutationObserver) ---
function getDrawerElements() {
    // Using the attribute selector from the original script
    // Verify this is still correct in your ST version
    return Array.from(document.querySelectorAll('[data-slide-toggle]'));
}

function isAnyDrawerOpen() {
    // Check the specific attribute value 'shown'
    return getDrawerElements().some(drawer => drawer.getAttribute('data-slide-toggle') === 'shown');
}

function startMonitoringDrawer() {
    if (isMonitoringDrawer || !isOverlayCollapsed) {
        // log('不启动抽屉监控 (已在运行或幕布条未折叠)');
        return; // Only monitor when manually collapsed
    }

    isMonitoringDrawer = true;
    drawerWasOpen = isAnyDrawerOpen(); // Check initial state *after* deciding to monitor

    log('开始监控抽屉状态 (data-slide-toggle="shown")，初始状态:', drawerWasOpen ? '打开' : '关闭');

    const observerConfig = {
        attributes: true,
        attributeFilter: ['data-slide-toggle'], // Monitor only this attribute
        subtree: true, // Check descendants of body
        childList: false,
        characterData: false
    };

    drawerObserver = new MutationObserver((mutationsList) => {
        // Optimization: Check relevant change *before* calling isAnyDrawerOpen
        let relevantChangeDetected = mutationsList.some(mutation =>
             mutation.type === 'attributes' && mutation.attributeName === 'data-slide-toggle'
        );


        if (relevantChangeDetected) {
            // log('检测到 data-slide-toggle 变化，重新评估状态...');
            const currentDrawerState = isAnyDrawerOpen();

            // Log only on actual state change
            if (drawerWasOpen !== currentDrawerState) {
                 log('抽屉整体状态变化:', drawerWasOpen ? '打开' : '关闭', '->', currentDrawerState ? '打开' : '关闭');
            }


            // Core logic: If drawers were open, are now closed, AND overlay is still collapsed
            if (drawerWasOpen && !currentDrawerState && isOverlayCollapsed) {
                log('所有抽屉已关闭 (基于 data-slide-toggle)，自动展开幕布条');
                expandOverlay(); // Expand the bar automatically
                // Expansion sets isOverlayCollapsed=false, implicitly stopping auto-expand loop
            }

            drawerWasOpen = currentDrawerState; // Update state for the next check
        }
    });

    drawerObserver.observe(document.body, observerConfig);
    log('Optimized drawerObserver 已附加到 body');
}

function stopMonitoringDrawer() {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
        isMonitoringDrawer = false;
        log('已停止监控抽屉状态');
    }
}

// --- SillyTavern Event Handlers ---
function handleCharacterLoaded(characterId) {
    log(`事件: CHARACTER_LOADED - ID: ${characterId}`);
    // Check if it's a different character than currently displayed
    const newId = `char-${characterId}`;
    if(currentDisplayedId !== newId){
         showOverlay();
    } else {
         log('加载的角色与当前显示的相同，无需操作');
    }

}

function handleCharacterDeleted(payload) {
    // payload = { id: deletedCharacterId, character: deletedCharacterObject }
    log(`事件: CHARACTER_DELETED - ID: ${payload.id}`);
    const deletedId = `char-${payload.id}`;
    // If the deleted character is the one currently displayed, hide the bar
    if (currentDisplayedId === deletedId) {
        log('当前显示的角色已被删除，隐藏幕布条');
        hideOverlay();
    }
}

function handleChatUpdated() {
    log('事件: CHAT_UPDATED');
    const context = getContext();

    // Determine the new potential ID
    let newId = null;
    if (context.groupId) {
        newId = `group-${context.groupId}`;
    } else if (context.characterId !== undefined) {
        newId = `char-${context.characterId}`;
    }

     log(`Chat Updated: Current ID: ${currentDisplayedId}, New Potential ID: ${newId}`);


    if (newId) {
        // If a chat is active (group or char)
        if (currentDisplayedId !== newId) {
            // Switched to a different chat or loaded initial chat
            log('聊天对象已更改或首次加载，显示/更新幕布条');
             showOverlay(); // Show/update for the new chat
        } else {
             // Chat content updated, but same char/group. Maybe update content?
             // Decide if you want to refresh on every chat update or only on load/switch.
             // For performance, only updating on load/switch (handled by showOverlay) is better.
             // log('聊天内容更新，但对象未变，暂不强制刷新');
             // Optionally: updateImageAndName(); // Uncomment to refresh on every message etc.
        }
    } else {
        // No chat active (neither group nor character)
        if (currentDisplayedId !== null) {
            log('已退出所有聊天，隐藏幕布条');
             hideOverlay(); // Hide the bar if we were showing something
        } else {
             // log('无活动聊天，幕布条已隐藏');
        }
    }
}


// --- Plugin Initialization ---
jQuery(async () => {
    log(`加载插件: ${extensionName}`);

    createOverlay(); // Create the DOM structure

    // Register SillyTavern event listeners
    eventSource.on(event_types.CHARACTER_LOADED, handleCharacterLoaded);
    eventSource.on(event_types.CHARACTER_DELETED, handleCharacterDeleted);
    eventSource.on(event_types.CHAT_UPDATED, handleChatUpdated);

    // Initial check: If a chat is already loaded when the plugin initializes
    log('执行初始状态检查...');
    handleChatUpdated(); // Run update logic once to catch initial state

    log(`插件 ${extensionName} 初始化完成。`);
});