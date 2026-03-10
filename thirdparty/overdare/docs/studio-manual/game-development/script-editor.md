# Script Editor

## Overview <a href="#overview" id="overview"></a>

The Script Editor in OVERDARE Studio is an essential tool for writing scripts, designed to facilitate easy code writing. It helps manage the development process efficiently and significantly reduce working time.



## Features <a href="#features" id="features"></a>

* The editor formats and highlights syntax in code.
* It provides an autocomplete function that suggests code phrases as you type.
* It allows you to search and replace code within an open script or across all scripts.
* It provides real-time feedback on code quality and compliance.
* It offers robust debugging capabilities using breakpoints, allowing precise tracking of code execution flow and effective issue analysis.



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### Opening a Script <a href="#opening-a-script" id="opening-a-script"></a>

Double-clicking a script in the Level Browser opens the Script Editor.

<figure><img src="../../../.gitbook/assets/image (68).png" alt=""><figcaption></figcaption></figure>



### Keyboard Shortcuts <a href="#keyboard-shortcuts" id="keyboard-shortcuts"></a>

| Shortcut              | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| Ctrl+S                | Save                                                                  |
| Ctrl+A                | Select All                                                            |
| Ctrl+C / Ctrl+V       | Copy/Paste                                                            |
| Ctrl+X                | Cut                                                                   |
| Ctrl+Z / Ctrl+Shift+Z | Undo/Redo                                                             |
| Ctrl+Wheel            | Increase or decrease the size of fonts                                |
| Alt+↑ / Alt+↓         | Swap the current line that the cursor is on with the line above/below |
| Ctrl+↑ / Ctrl+↓       | Scroll by one line                                                    |
| Ctrl+Home / Ctrl+End  | Move to the first/last line                                           |
| Ctrl+F                | Find code in the current script                                       |
| Ctrl+H                | Replace code in the current script                                    |
| Ctrl+Shift+F          | Find/Replace across all scripts                                       |
| Ctrl+G                | Go to a specific line                                                 |
| Ctrl+W                | Close Script Tab                                                      |
| Ctrl+/                | Comment/Uncomment Selected Area                                       |



### Autocomplete <a href="#autocomplete" id="autocomplete"></a>

While entering code, the editor suggests relevant functions, variables, and syntax, improving writing speed and productivity.

<figure><img src="../../../.gitbook/assets/image (69).png" alt=""><figcaption></figcaption></figure>



When autocomplete suggestions appear, you can navigate the list using the up and down arrow keys, then press **Tab** or **Enter** to insert the selected suggestion into the script.

If autocomplete is not needed, press **Esc** to close the suggestions.



### Find and Replace <a href="#find-and-replace" id="find-and-replace"></a>

Using the **Find (Ctrl+F)** or **Replace (Ctrl+H)** functions, you can search and replace code within the current script. If multiple matches are found, you can navigate through them using the **Enter key**.

<figure><img src="../../../.gitbook/assets/image (70).png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Match case
* 2️⃣ Match whole word
* 3️⃣ Use regular expressions
* 4️⃣ Next match
* 5️⃣ Previous match
* 6️⃣ Close
* 7️⃣ Replace selected word
* 8️⃣ Replace all



### Find All and Replace All <a href="#find-all-and-replace-all" id="find-all-and-replace-all"></a>

By using the **Find/Replace All function (Ctrl+Shift+F)**, you can search and replace code across all scripts. **Double-clicking** a result in the output panel moves the cursor to the corresponding line.

<figure><img src="../../../.gitbook/assets/image (71).png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Match case
* 2️⃣ Match whole word
* 3️⃣ Use regular expressions
* 4️⃣ Next match
* 5️⃣ Previous match
* 6️⃣ Script filter
* 7️⃣ Close
* 8️⃣ Replace selected word
* 9️⃣️ Replace all



## Problem <a href="#problem" id="problem"></a>

The **Problem panel** analyzes the script being written and highlights active errors and warnings. Errors are also underlined in red within the Script Editor.

**Double-clicking** a log entry in the Problem panel moves the cursor to the corresponding line.

<figure><img src="../../../.gitbook/assets/image (72).png" alt=""><figcaption></figcaption></figure>



## Breakpoint <a href="#breakpoint" id="breakpoint"></a>

The **Breakpoint** function is a script debugging tool that allows you to pause the execution of a script at a specific point to examine the state of that point or analyze any issues during the script’s execution.



{% content-ref url="../../script-manual/debugging-and-optimization/breakpoint.md" %}
[breakpoint.md](../../script-manual/debugging-and-optimization/breakpoint.md)
{% endcontent-ref %}
