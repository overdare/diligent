# Basic Guide to Lua

## Overview

Luau is a lightweight and fast scripting language extended from Lua, which can be easily learned and used even by beginners. In OVERDARE Studio, it serves as an optimized tool for implementing various functionalities while providing high creative freedom.



## Comments

Comments are used to explain the functionality of the code or to disable code from running.

```lua
-- Single-line comment
local  Num1 = 1 

--[[
local Num2 = 2
Multi-line comment
]]--  

local  Num3 = 3
```



## Code Execution Order

Code runs from top to bottom, and you cannot call functions or variables declared below from above.

```lua
SomeFunc() -- Error occurs  

local  function  SomeFunc()
    print("SomeFunc")
end

SomeFunc() -- Works as intended
```



## Variables

In Lua, **you do not specify data types** like integer, float, or string when declaring a variable. The scope of a variable can be defined as either **local** (accessible only within the current script) or **global** (accessible from other scripts).

<pre class="language-lua"><code class="lang-lua">-- Local variable (accessible only within the script where it is declared)
local Num1 = 5
local Num2 = 1.66 
  

-- Global variable (accessible from other scripts as well)
<strong>_G.SomeVar = 50
</strong>print(_G.SomeVar) -- Prints 50


-- Multiple variable assignments possible
local Text1, Text2 = "A", "B"


-- Assign a function to a variable and call it as a variable
local function SomeFunction()
    print("SomeFunction")
end  

local Func = SomeFunction
Func()
</code></pre>



## Functions

Like variables, the scope of a function can be defined as **local** (accessible only within the current script) or **global** (accessible from other scripts).

<pre class="language-lua"><code class="lang-lua">-- If there are more arguments or return values than expected, the extra ones are discarded. If there are fewer, the missing ones are treated as nil.
local function GetVector(x, y, z)
    print("GetVector X", x, "Y", y, "Z", z)
end
<strong>GetVector(1, 0)       -- z is nil
</strong><strong>GetVector(1, 0, 5, 3) -- Last value is discarded  
</strong>  

-- You can return multiple values or use multiple variable assignments.
local function GetVector(x, y, z)
    return x, y, z
end
local x, y, z = GetVecor(1, 0, 1)
  

-- A function's variable arguments are indicated by ...
local function Sum(...)
    local a, b, c = ... -- Missing arguments are treated as nil.
end
Sum(1, 2)
    

-- Variable arguments can also be used with fixed parameters
local function Sum(value, ...)

end

  
-- Return values can also be treated as variable arguments
local function Sum(...)
<strong>    return ...
</strong>end

</code></pre>



## local and global

The variable/function declared with the **local keyword** is only valid within the script in which it is declared and cannot be accessed externally. Therefore, even if local variables/functions with the same name are used in multiple scripts, they do not affect each other.

Variables or functions declared in the **global table (\_G)** can be accessed from any script. However, only one global variable/function with the same name can exist.



## Control Statements

Control statements are used to control the flow (execution order) of the code.



### if

```lua
if SomeNumber > 0 then 
    print("Positive Number")
    
elseif SomeNumber > 0 then
    print("Negative Number")
    
else
    print("Zero")
end
```



### goto

The goto statement is not supported.



### do <a href="#do" id="do"></a>

```lua
local number = 10

do
    local number = 5
    print("number (in do) : ", number)
end

print("number (out do) : ", number)
```



## Loops <a href="#loops" id="loops"></a>

Loops are used to repeatedly execute the same block of code until a specific condition is met.



### for <a href="#for" id="for"></a>

```lua
-- Starting value, condition, increment
for i = 1, 10, 1 do 
    print(i) 
    break
end   

-- The increment in the for loop is optional and defaults to 1 if omitted.
for i = 1, 20 do 
    print(i)
end
```



### while <a href="#while" id="while"></a>

```lua
local ConditionValue = 0

while ConditionValue < 5 do 
    ConditionValue = ConditionValue + 1
    print(ConditionValue)
    
    if ConditionValue > 3 then
    	break
    end
end
```



### repeat <a href="#repeat" id="repeat"></a>

```lua
-- Repeats the code until the condition is true
repeat wait(0.1) until SomeCondition
```



## Logical Operators <a href="#logical-operators" id="logical-operators"></a>

Logical operators are used to combine or evaluate conditions in conditional or control statements.

```lua
-- Using logical operators inside if statements
if isMonster == true and isBoss == true then 
    print("Monster")
end

if isWalk == true or isRun == true then
    print("On the move")
end

if not isCharacter then 
    print("Not Character")
end  
  

-- Returning values based on conditions
local resultA = a and b -- If the first value is false, return the first value, otherwise return the second value
local resultB = a or b -- If the first value is true, return the first value, otherwise return the second value
local resultC = not a -- Returns true if nil or false
```



## Tables <a href="#tables" id="tables"></a>

Tables are complex data structures that store data in key-value pairs, which can also manage data like arrays.

```lua
local NumberList = { 1, 2, 3 }
print(#NumberList) -- Returns the size of the table
  

-- Array implementation
local MatrixData = {}
for x = 1, 5 do
    MatrixData[x] = {}
    for y = 1, 2 do
        MatrixData[x][y] = "Coordinate_" .. x .. "x" .. y
        print(MatrixData[x][y])
    end
end  
  

-- Table consisting of Key(Name) and Index(EquipItemIDList)
local MonsterData =
{
    Name = "Orc",
    EquipItemIDList = 
    {
        1, 5, 4
    }	
}
print(MonsterData.Name)
print(MonsterData["Name"])
for i = 1, #MonsterData.EquipItemIDList do
    print(MonsterData.EquipItemIDList[i])
end
```



## Coroutines <a href="#coroutines" id="coroutines"></a>

Coroutines provide the ability to pause execution and resume it at a later time. Unlike regular functions, coroutines maintain their state when paused and can continue execution from that point, making them useful for asynchronous tasks or complex flow control.

```lua
print("1")

local printCoroutine = coroutine.create(function()
    wait(2)
    print("2")
end)
coroutine.resume(printCoroutine)

print("3") -- Since the coroutine runs asynchronously, the output will be 1 -> 3 -> 2
```



## Luau In-depth Learning

Compared to standard Lua, Luau offers a wide range of advanced features. Refer to the guide below for in-depth learning.

{% content-ref url="luau-guide.md" %}
[luau-guide.md](luau-guide.md)
{% endcontent-ref %}
