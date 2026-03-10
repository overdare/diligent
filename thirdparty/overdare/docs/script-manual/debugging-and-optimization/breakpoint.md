# Breakpoint

## Overview <a href="#overview" id="overview"></a>

The **Breakpoint** function is a script debugging tool that allows you to pause the execution of a script at a specific point to examine the state of that point or analyze any issues during the script’s execution.

When a breakpoint is hit, you can check the current execution status through debugging panels such as **Watch and Call Stack** and step through the code for further analysis.



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### 1. Setting a Breakpoint in the Script Editor <a href="#setting-a-breakpoint-in-the-script-editor" id="setting-a-breakpoint-in-the-script-editor"></a>

Open the script that requires debugging, find the line of code where you want to set the breakpoint, and click on the **horizontal bar to the left of the line number** to create a breakpoint.

<figure><img src="../../../.gitbook/assets/Group 1.png" alt=""><figcaption></figcaption></figure>



When a breakpoint is created, a red circle (🔴) appears. You can deactivate it by clicking the circle again (⭕).

<figure><img src="../../../.gitbook/assets/Group 2.png" alt=""><figcaption></figcaption></figure>



You can edit a breakpoint by right-clicking on it and then pressing each function in the menu.

<div align="left"><figure><img src="../../../.gitbook/assets/image (40).png" alt=""><figcaption></figcaption></figure></div>

* Edit Breakpoint: Set breakpoint condition
* Disable Breakpoint: Disable breakpoint
* Delete Breakpoint: Delete breakpoint



### 2. Execute the line of code with the breakpoint set in the test play. <a href="#execute-the-line-of-code-with-the-breakpoint-set-in-the-test-play" id="execute-the-line-of-code-with-the-breakpoint-set-in-the-test-play"></a>

Run a test play, then set the game so that the **code line with the breakpoint** is executed.

When the line of code where the breakpoint is set is executed (the breakpoint is hit), the game stops and an **arrow (➡)** is displayed on the line of the hit breakpoint. In this state, you can analyze the Call Stack or Watch.

<figure><img src="../../../.gitbook/assets/image (41).png" alt=""><figcaption></figcaption></figure>



### 3. Watch Analysis <a href="#watch-analysis" id="watch-analysis"></a>

In the Watch tab, you can check the current state, such as the values of variables or tracking specific variables.

<figure><img src="../../../.gitbook/assets/Group 4.png" alt=""><figcaption></figcaption></figure>



### 4. Call Stack Analysis <a href="#call-stack-analysis" id="call-stack-analysis"></a>

In the Call Stack tab, you can check the flow of code calls.

<figure><img src="../../../.gitbook/assets/Group 3.png" alt=""><figcaption></figcaption></figure>



By clicking the button at the top of the Call Stack tab, you can exit the hit breakpoint to move to the next one or resume the paused game.

<figure><img src="../../../.gitbook/assets/image (42).png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Step Into: Enter the **function** on the current line and continue debugging.
* 2️⃣ Step Over: Execute the function on the current line **without entering it, then move to the next line**
* 3️⃣ Step Out: Execute the rest of the current function and return to the **parent function**.



### 5. Breakpoint Bulk Editing <a href="#breakpoint-bulk-editing" id="breakpoint-bulk-editing"></a>

If breakpoints are set in multiple scripts, you can view the entire list in the Breakpoints tab without opening each script. You can also enable/disable or delete all breakpoints by clicking the buttons at the top of the Breakpoints tab.

<figure><img src="../../../.gitbook/assets/image (43).png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Disable All Breakpoints : Enable/disable all breakpoints
* 1️⃣ Delete All Breakpoints : Delete all breakpoints



### 6. Issues and Solutions <a href="#issues-and-solutions" id="issues-and-solutions"></a>

Based on the Call Stack and Watch information, you can effectively analyze issues during debugging by checking the value of a specific variable, tracking changes in object properties, unexpected function calls, and unintended code flow.



## Usage Example <a href="#usage-example" id="usage-example"></a>

Breakpoints are a highly effective tool for identifying and fixing issues in your code. For example, if the code calculating the cumulative sum in a loop produces unexpected results, you can use the Watch tab to track the variable’s values. This will help you quickly spot errors such as incorrect initial values or mistakes in the calculation formula.

The Call Stack tab is also useful for tracing the order of function calls and understanding the execution path of your code. For example, if a particular function is called with unexpected values or if the call order is off, you can check the Call Stack to pinpoint the root cause of the issue.

By effectively utilizing debugging tools, you can systematically analyze variable states, function call flows, and the logic of your code, which can significantly **speed up problem-solving**.
