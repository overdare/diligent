# Coding Style

## Overview <a href="#overview" id="overview"></a>

Coding style refers to **guidelines designed to ensure consistency and readability of code**. These are **recommended conventions** to reduce ambiguity that may arise when writing code and to improve collaboration and maintenance.

Lua script has a flexible and concise grammar structure compared to other languages, so if developers do not establish a unified convention, the **expression style of the code can become excessively diverse**. Therefore, by using a consistent coding style, you can quickly understand the meaning of the code, such as the scope or purpose of variables, and increase development efficiency.



## Naming Conventions Based on Declaration Scope <a href="#naming-conventions-based-on-declaration-scope" id="naming-conventions-based-on-declaration-scope"></a>

The following rules are used to distinguish between **file-scoped variables**, which are declared at the top of the script, and **local variables**, which are declared within a specific scope, such as a function or control statement.



### Variables <a href="#variables" id="variables"></a>

File-scoped variables declared at the **top of the script** should be named with the **first letter of each word in uppercase**.

```lua
-- Good
local Number = 1       
_G.GlobalValue = 2 


-- Bad
local number = 1 
_G.globalValue = 2
```



Variables declared **within specific scopes** such as functions or control statements should be named with **only the first letter in lowercase**.

```lua
-- Good
local function SomeFunction()
    local value = 3
    
    if value >= 3 then
        local someBoolean = false
    end
end


-- Bad
local function SomeFunction()
    local Value = 3
    
    if Value >= 3 then
        local SomeBoolean = false
    end
end
```



### Functions <a href="#functions" id="functions"></a>

Function names should be capitalized with the **first letter of each word in uppercase**.

```lua
-- Good
local function SomeFunction()
    print("Do Someting")
end

function _G.SomeFunction()
    print("Do Someting")
end


-- Bad
local function someFunction()
    print("Do Someting")
end

function _G.someFunction()
    print("Do Someting")
end
```



## Function Parameters and Return Values <a href="#function-parameters-and-return-values" id="function-parameters-and-return-values"></a>

Function parameters and return values must be named with **the first letter in lowercase**, and spaces should be placed between parameters.

```lua
-- Good
local function Sum(numValue1, numValue2)
    local result = numValue1 + numValue2
    local isSuccess = (result ~= nil)
    return isSuccess, result
end


-- Bad
local function Sum(NumValue1,NumValue2)
    local result = NumValue1 + NumValue2
    local isSuccess = (result ~= nil)
    return isSuccess,result
end
```



## Operators <a href="#operators" id="operators"></a>

Add a **space** between operators.

```lua
-- Good
local Sum = 1 + 5
local IsPositiveNumber = Sum > 0

if SomeValue == 1 && SomeValue == 2 then
    print("Valid Value")
elseif SomeValue == 3 then
    print("Value Exceeded)
else
    print("Invalid Value"")  
end


-- Bad
local Sum=1+5
local IsPositiveNumber=Sum>0

if SomeValue==1&&SomeValue==2 then
    print("Valid Value")
elseif SomeValue==3 then
    print("Value Exceeded)
else
    print("Invalid Value"")  
end
```



## Indentation and Line Breaks <a href="#indentation-and-line-breaks" id="indentation-and-line-breaks"></a>

Use **indentation** to clarify the hierarchy of the code, such as the scope and flow.

```lua
-- Good
if someCondition1 then
    if someCondition2 then
        print("Correct!")
    end
end


-- Bad
if someCondition1 then
if someCondition2 then
    print("Correct!")
end
end
```



Include a **line break** at the beginning of a control statement, such as a table, conditional, or loop.

```lua
-- Good
local NumberList = 
{
    1, 2, 3
}

for i = 1, 5 do
    print(i)
end


-- Bad
local NumberList = {
    1, 2, 3
}

for i = 1, 5 do	print(i)
end
```



## In a Team Project <a href="#in-a-team-project" id="in-a-team-project"></a>

In a collaborative project, it is important to unify the coding style among team members. A consistent coding style improves code readability, makes maintenance easier, and helps smooth collaboration among team members. Therefore, it is advisable to define coding rules in the early stages of the project and ensure that everyone follows them. Agree upon variable names, function names, indentation styles, etc., and proceed with the work based on these guidelines!
