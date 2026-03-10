# JSON and HTTP Communication

## Overview

You can communicate with external HTTP servers using HttpService. You can retrieve data from an external API server to use in the world, or send data to an external API server and use the response data in the world.



## How to Use

| Function              | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| GetAsync(url)         | Receives a response from the URL                                         |
| PostAsync(url, data)  | Sends data to the URL and receives a response                            |
| JSONEncode(tableData) | Converts tableData in the table format into a JSON string and returns it |
| JSONDecode(json)      | Converts JSON in the JSON format into a table format and returns it      |



## Receiving a response from the URL

This is an example code that sends an HTTP GET request to the URL provided in the baseUrl variable, stores the response in the response variable, and prints it.

```lua
-- Imports HttpService
local HttpService = game:GetService("HttpService")
local baseUrl = "Enter the HTTP URL here"

local success, errorMessageOrResult, response = nil, nil, nil

local function HttpGet()
    -- Handles exceptions with pcall() as asynchronous requests can fail or encounter errors
    success, errorMessageOrResult = pcall(function()
        -- Sends an HTTP GET request to the "baseUrl" address and stores the response in the "response" variable
        response = HttpService:GetAsync(baseUrl)
    end)
    
    local messageSuccess = string.format("success: %s", success)
    local messageErrorOrResult = string.format("errorMessageOrResult: %s", errorMessageOrResult)
    local messageResponse = string.format("response: %s", response)
    
    print("messageSuccess: ", messageSuccess)
    print("messageErrorOrResult: ", messageErrorOrResult)
    print("messageResponse: ", messageResponse)
end
```



## Sending JSON Data to the URL to Receive a Response

This is an example code that encodes table data used in the world to JSON, sends an HTTP POST request to the URL specified in the baseUrl variable, stores the response in the response variable, and prints it.

```lua
-- Imports HttpService
local HttpService = game:GetService("HttpService")
local baseUrl = "Enter the HTTP URL here"

local success, errorMessageOrResult, response = nil, nil, nil

local function HttpPost()
    -- Defines data to send to the URL
    local data = 
    {
        ["message"] = "Hello OVERDARE!",
        ["data"] = 10,
    }

    -- Encodes data to JSON
    local jsonData = HttpService:JSONEncode(data)

    -- Handles exceptions with pcall() as asynchronous requests can fail or encounter errors 
    success, errorMessageOrResult = pcall(function()
        -- Sends an HTTP POST request with "jsonData" to the "baseUrl" address and stores the response in the "response" variable 
        response = HttpService:PostAsync(baseUrl, jsonData)
    end)

    local messageSuccess = string.format("success: %s", success)
    local messageErrorOrResult = string.format("errorMessageOrResult: %s", errorMessageOrResult)
    local messageResponse = string.format("response: %s", response)
    
    print("messageSuccess: ", messageSuccess)
    print("messageErrorOrResult: ", messageErrorOrResult)
    print("messageResponse: ", messageResponse)
end
```



## Using JSON Data Received from the URL

This is an example code that sends an HTTP GET request to the URL provided in the baseUrl variable, stores the response in the response variable, decodes the response (assuming it is JSON) into a table, and prints it.

```lua
-- Imports HttpService
local HttpService = game:GetService("HttpService")
local baseUrl = "Enter the HTTP URL here"

local success, errorMessageOrResult, response = nil, nil, nil

local function HttpGetApplication()
    -- Handles exceptions with pcall() as asynchronous requests can fail or encounter errors
    success, errorMessageOrResult = pcall(function()
        --Sends an HTTP GET request to the "baseUrl" address and stores the response in the "response" variable
        response = HttpService:GetAsync(baseUrl)
        -- Decodes the JSON string into a table and stores it in the "response" variable 
        response = HttpService:JSONDecode(response)
    end)

    local messageSuccess = string.format("success: %s", success)
    local messageErrorOrResult = string.format("errorMessageOrResult: %s", errorMessageOrResult)
    local messageResponse = string.format("response.data: %s", response.data)
    
    print("messageSuccess: ", messageSuccess)
    print("messageErrorOrResult: ", messageErrorOrResult)
    print("messageResponse: ", messageResponse)
end
```



## Note

There may be rate limits, API calls per minute, for each API address. Make sure to check the request limits of the API address when implementing your desired functionality.
