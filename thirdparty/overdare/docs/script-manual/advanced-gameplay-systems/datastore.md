# Saving & Loading Data

## Overview

Use DataStore to save and retrieve core data, such as the player’s level, EXP, and current gold. This allows you to maintain the player’s progress over time and develop games with growth mechanics, such as in RPGs.

## How to Use

### Supported Data Types

<table><thead><tr><th width="146.66668701171875">Data Type</th><th>Supported O/X</th></tr></thead><tbody><tr><td>number</td><td>O</td></tr><tr><td>string</td><td>O</td></tr><tr><td>bool</td><td>O</td></tr><tr><td>table</td><td>O</td></tr><tr><td>object</td><td>Not supported.</td></tr><tr><td>Functions</td><td>Not supported.</td></tr></tbody></table>

### Default Structure

Use the GetDataStore function of DataStoreService to retrieve DataStore objects with a designated name. You can save or retrieve data using a **key-value format** within the DataStore object.

* **Key**: Unique name that identifies data (e.g. PlayerGold)
* **Value**: Data to be saved (e.g. 1,000)

Additionally, you can store additional information for the key:

* **UserIds (Array)**: A list of UserIds related to the data.
* **Metadata (Table)**: Additional metadata information to be stored.

These two additional fields can be retrieved using **DataStoreKeyInfo**.

```lua
local DataStoreService = game:GetService("DataStoreService") 
local GoldStore = DataStoreService:GetDataStore("PlayerGold")

local function LoadMetadata(player)
    local success, errorMessageOrLoadValue, keyInfo = pcall(function()
       -- Key : PlayerName
        return GoldStore:GetAsync(player.UserId)
    end)

    if not success then
        print("errorMessage : ", errorMessageOrLoadValue)
    else
        local loadValue = errorMessageOrLoadValue
        local userIds = keyInfo:GetUserIds()
        local metadata = keyInfo:GetMetadata()
        print(player.Name, "Load PlayerGold : ", loadValue)
        print(" - UserIds : ", table.concat(userIds, ", "))
        print(" - Metadata: ", metadata)
    end
end
```

<table><thead><tr><th width="210.6666259765625">Function</th><th>Description</th></tr></thead><tbody><tr><td>GetDataStore(name)</td><td>Retrieve Datastore object that corresponds to the name</td></tr><tr><td>GetAsync(key)</td><td>Retrieve data that corresponds to the key in the Datastore object</td></tr><tr><td>SetAsync(key, value)</td><td>Save (overwrite) data in the key in the Datastore object</td></tr><tr><td>IncrementAsync(key, delta, userIds<em>(*optional)</em>, datastoreSetOption<em>(*optional)</em>)</td><td>Increases/Decreases the data corresponding to the key in the Datastore object (only works for number type data)</td></tr><tr><td>UpdateAsync(key, callback)</td><td>Updates the data corresponding to the key in the Datastore object through the callback</td></tr><tr><td>RemoveAsync(key)</td><td>Deletes the data corresponding to the key in the Datastore object</td></tr></tbody></table>

### Data Store Retrieval

```lua
local DataStoreService = game:GetService("DataStoreService") 
local GoldStore = DataStoreService:GetDataStore("PlayerGold") 
```

### Saving

```lua
local function SaveData(player)
    local success, errorMessageOrLoadValue = pcall(function()
        local saveValue = 1 
        
        -- Key : PlayerName / Value : SaveValue
        GoldStore:SetAsync(player.UserId, saveValue) 
    end)

    if not success then
        print("errorMessage : ", errorMessageOrLoadValue)
    end
end
```

### Retrieving

```lua
local function LoadData(player)
    local success, errorMessageOrLoadValue = pcall(function()
       -- Key : PlayerName
        return GoldStore:GetAsync(player.UserId)
    end)

    if not success then
        print("errorMessage : ", errorMessageOrLoadValue)
    else
        local loadValue = errorMessageOrLoadValue
        print(player.Name, "Load PlayerGold : ", loadValue)
    end
end
```

### Updating

When using DataStore to save player data, simply relying on GetAsync and SetAsync can lead to **race conditions** when multiple users are reading and writing data simultaneously. This can result in one user’s saved value being overwritten by another user’s save request, or data loss occurring in some cases.

For example, while fetching a value with GetAsync and processing it, if another event or server call triggers SetAsync and updates the value, there is no way to verify if the value was updated during processing. As a result, the value calculated based on the outdated value could **overwrite** the most recent update, causing the previous changes to be lost.

To prevent such race conditions and ensure data integrity, a more secure data handling approach is required.

#### IncrementAsync

For cases where you simply need to increase (or decrease) a numerical value, IncrementAsync can be used. IncrementAsync supports atomic operations internally, ensuring that multiple users can safely increment the value simultaneously without data conflicts. Therefore, for **number data** that requires simple accumulation, such as coins, experience points, or scores, IncrementAsync is the simplest and most efficient choice.

```lua
local function IncrementGold(player, delta)
    local success, errorMessageOrLoadValue = pcall(function()
        return GoldStore:IncrementAsync(player.UserId, delta)
    end)
    
    if not success then
        print("errorMessage : ", errorMessageOrLoadValue)
    else
        local loadValue = errorMessageOrLoadValue
        print(player.Name, "Load PlayerGold : ", loadValue)
    end
end
```

#### UpdateAsync

However, IncrementAsync is only valid for numeric data types and cannot handle more complex data updates such as multiplication, division, or other conditional logic.

The UpdateAsync function is designed to atomically handle the process of reading, modifying, and saving values in the DataStore. This ensures that even in concurrent access situations, the value can be updated reliably without data loss.

UpdateAsync takes a **callback function** as an argument, passes the currently stored value to the callback, and then saves the value returned by the callback to the DataStore. If multiple requests come in simultaneously and a data conflict occurs, UpdateAsync automatically fetches the latest value and reruns the callback to resolve the conflict. This process repeats until the data is safely updated.

The callback function enables ACID (Atomicity, Consistency, Isolation, Durability) handling, ensuring the stability and integrity of the data transaction. Based on the returned value, the actual application of the update can be determined. For example, if the callback returns nil, the update will be canceled. This functionality allows for the implementation of conditional data updates, integrity checks, and other complex logic.

```lua
local function UpdateGold(player, delta)
    local success, errorMessageOrLoadValue, keyInfo = pcall(function()
        return GoldStore:UpdateAsync(player.UserId, function(currentGold, keyInfo)
            local newGold = (currentGold or 0) + delta		
            return { newGold, keyInfo:GetUserIds(), keyInfo:GetMetadata() }
        end)
    end)
    
    if not success then
        print("errorMessage : ", errorMessageOrLoadValue)
    else
        local loadValue = errorMessageOrLoadValue
        print(player.Name, "Load PlayerGold : ", loadValue)
    end
end
```

### Deleting Data

```lua
local function RemoveData(player)
    local success, errorMessage = pcall(function()
        GoldStore:RemoveAsync(player.UserId)
    end)
    
    if not success then
        print("errorMessage : ", errorMessage)
    end
end
```

## Full Code Example

The following code retrieves data stored on the server **when a player enters the game**. If no saved value is found, the **initial value** is set, and this value is assigned as the player’s Attribute.

When the **save function** is called, the current value of the Attribute is saved to the server.

```lua
DataManager = {}

local Players = game:GetService("Players") 
local DataStoreService = game:GetService("DataStoreService") 

-- Definition of various data types that are saved or retrieved
local PlayerData =
{
    { Name = "PlayerGold", InitValue = 0, Store = nil },
}

for i = 1, #PlayerData do
    PlayerData[i].Store = DataStoreService:GetDataStore(PlayerData[i].Name) 
end

--------------------------------------------------------
-- Saves the current value to the server
function DataManager:SavePlayerData(player)
    repeat wait() until player:GetAttribute("IsDataLoaded")    
    
    print(player, "> SavePlayerData")        
    
    local text = ">>>> Save : "
    
    for i = 1, #PlayerData do
        local playerData = PlayerData[i]
        local store = playerData.Store        
        
        local success, errorMessageOrLoadValue = pcall(function()
            -- Reads the player's Attribute value and saves it to the server.
            local currentValue = player:GetAttribute(playerData.Name)
            
            store:SetAsync(player.UserId, currentValue) 
            
            return currentValue
        end)
    
        if not success then
            text = text .. "errorMessage : " .. errorMessageOrLoadValue
        else
            local loadValue = errorMessageOrLoadValue
            
            if i > 1 then
                text = text .. ", "
            end
            text = text .. player.Name .. " / Save " .. playerData.Name .. " : " .. tostring(loadValue)
        end
    end
            
    print(player, text)
end
-- Automatically saves when the player exits the game.
Players.PlayerRemoving:Connect(function(player) DataManager:SavePlayerData(player) end)

--------------------------------------------------------
-- Retrieves the value saved in the server.
function DataManager:LoadPlayerData(player)
    print(player, "> LoadPlayerData")    
    
    local text = ">>>> Load : "    
    
    for i = 1, #PlayerData do
        local playerData = PlayerData[i]
        local store = playerData.Store        
        
        local success, errorMessageOrLoadValue = pcall(function()            
            return store:GetAsync(player.UserId)
        end)
    
        if not success then
            text = text .. "errorMessage : " .. errorMessageOrLoadValue
        else
            local loadValue = errorMessageOrLoadValue
            
            -- If no saved value exists, the initial value (InitValue) is set and saved to the server.
            if loadValue == nil then      
                loadValue = playerData.InitValue    
                            
                store:SetAsync(player.UserId, loadValue) 
            end    
            
            -- The retrieved value is set as the player's Attribute
            player:SetAttribute(playerData.Name, loadValue)
            
            if i > 1 then
                text = text .. ", "
            end
            text = text .. player.Name .. " / Load " .. playerData.Name .. " : " .. tostring(loadValue)
        end
    end
    
    player:SetAttribute("IsDataLoaded", true)
    
    print(player, text)
end

--------------------------------------------------------
-- Retrieves data when the player enters the game.
local function LoadPlayerDataWhenEnter(player)
    local function onAddCharacter(character)
        print(player.Name ..  " LoadPlayerDataWhenEnter")    
        
        DataManager:LoadPlayerData(player)    
    end
    player.CharacterAdded:Connect(onAddCharacter)    
end
Players.PlayerAdded:Connect(LoadPlayerDataWhenEnter)

--------------------------------------------------------
-- Example of data retrieval
local function LoadExample(player)
    DataManager:LoadPlayerData(player)
end

-- Example of saving data
local function SaveExample(player)        
    -- Example code that changes the value prior to saving
    for i = 1, #PlayerData do
        local playerData = PlayerData[i]
        
        local currentValue = player:GetAttribute(playerData.Name)         
        
        if currentValue ~= nil then
            local newValue = currentValue + 1
            
            player:SetAttribute(playerData.Name, newValue) 
        end
    end        
    
    DataManager:SavePlayerData(player)
end
```

* **LoadPlayerDataWhenEnter(player)**
  * Load when the player logs in to the game\\
* **DataManager:LoadPlayerData(player)**
  * Retrieves player data saved in the server (GetAsync)
    * If no saved value exists, the **initial value (InitValue)** is set and saved to the server.
    * The retrieved value is set as the player’s Attribute\\
* **DataManager:SavePlayerData(player)**
  * Reads the player’s Attribute value and saves it to the server (SetAsync)
  * Automatically saves when the player exits the game through the PlayerRemoving event.

## Usage Example

When saving or retrieving data from DataStore, you can manage both individual user data and **global game data** depending on how the **key value is structured**.

For example, if the key is set up as “RaceGameLeaderBoard” instead of “[Player.Name](http://player.name/),” you can **manage ranking information stored on the server** rather than data specific to an individual player.

This approach allows you to save and retrieve **game data across all areas**, such as leaderboards, event progress, server settings, etc.

## Difference Between Actions in Published and Test Environments

After publishing, data is saved and retrieved on the live server in mobile environments. However, in studio test environments, data is temporarily stored locally. When the studio session ends, this local data is automatically deleted.

## Important Notes

* If the player starts playing the game before the data is fully loaded, an error may occur. To prevent this, display a loading UI until the data has finished loading.
* Design the data to be saved in a structure that is as compact and simple as possible.
* Excessive requests can lead to data save failures, so avoid making repeated saves within a short time frame.
  * API retrieval cannot exceed 150 requests per minute. Exceeding this limit may result in restrictions on the server.
* If the game unexpectedly ends or there is a server collision, data may be lost. To prevent this, ensure that data is saved periodically.
* Saving and retrieval may fail, so use pcall to prevent errors and add a retry logic.
