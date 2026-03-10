# Conveniently Managing Coroutine Using Task

## Overview

task is a library that provides functionality for threads scheduling to support asynchronous tasks.



## How to Use

| Features                                    | Description                                                                                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| task.wait(delay)                            | Can pause a thread for delay for the specified number of delay seconds, after which the current thread will resume. Once executed, it returns the actual time the thread was paused.    |
| task.spawn(functionOrCoroutine, ...)        | Creates a coroutine for functionOrCoroutine and resumes it immediately. All arguments following functionOrCoroutine are passed as parameters to functionOrCoroutine.                    |
| task.delay(delay, functionOrCoroutine, ...) | Creates a coroutine and resumes it after the specified number of delay seconds. All arguments following functionOrCoroutine are passed as parameters to functionOrCoroutine.            |
| task.defer(functionOrCoroutine, ...)        | Schedules a coroutine function to run as soon as the currently running coroutine finishes. All arguments following functionOrCoroutine are passed as parameters to functionOrCoroutine. |
| task.cancel(coroutine)                      | Cancels a coroutine that has not yet started.                                                                                                                                           |



### 1. Pausing the Thread

The following is an example of pausing the current thread for 1 second.

```lua
local elapsedTime = task.wait(1)
print(`task.wait(1) real waited time(sec): {elapsedTime}`)
```



### 2. Creating and Running a Coroutine Immediately

The following is an example of passing and printing multiple types of data to a coroutine that is created and resumed immediately.

```lua
local function TaskSpawn(a, b, c, tbl)
    print("task.spawn executed", a, b, c)
    for k, v in pairs(tbl) do
        print(`["{k}"]: {v} ({typeof(v)})`)
    end
end
task.spawn(TaskSpawn, "arg1", 123, true, {x = 78, y = "90"})
```



### 3. Running the Coroutine Function after a Set Duration

The following is an example of creating a coroutine and resuming it after 1.5 seconds. A string-type message is passed to the coroutine, and the created coroutine is printed.

```lua
local function TaskDelay(message)
    print("task.delay executed: ", message)
end
local delayedCoroutine= task.delay(1.5, TaskDelay, "Here is delayed message")
print(`delayedCoroutine: {delayedCoroutine}`)
```



### 4. Scheduling a New Coroutine Function to Run After the Current Coroutine Ends

The following is an example of passing and printing several pieces of data to a new coroutine that is resumed after the currently running coroutine finishes.

```lua
local function TaskDefer(x, y)
    print("task.defer executed: ", x, y)
end
task.defer(TaskDefer, "defer_arg", 456)
```



### 5. Canceling a Scheduled Coroutine Function

The following example cancels the most recently scheduled coroutine function by using task.spawn(), task.delay(), or task.defer(). Note that coroutines that are already running cannot be stopped.

```lua
local function TaskDelayForCancel()
    print("This should not be print")
end
local cancelCoroutine = task.delay(5, TaskDelayForCancel)
task.cancel(cancelCoroutine)
```
