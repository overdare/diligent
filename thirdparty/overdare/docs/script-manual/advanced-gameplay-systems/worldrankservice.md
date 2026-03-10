# App Leaderboard

## Overview

The kills, points, and other key indices acquired in gameplay can be converted into score and upload to **WorldRankService’s leaderboard**.&#x20;

Uploaded score and rank can be checked from both the **app (out-game) and in-game (world)**. Players can compete each other with this and significantly boosts world participation and overall activeness.



## How to Use

### Rank System Activation & Icon Settings

You can configure whether to use the rank system and set the rank icon in the Ranking System section at the bottom of the World Management page.

<figure><img src="../../../.gitbook/assets/World-Rank-Hub.png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Ranking System Activation
  * When set to true, ranks are displayed in both the app (out-game) and in-game, and player scores are recorded.
  * When set to false, ranks are not displayed, and score record requests are not processed.
* 2️⃣ Ranking Icon
  * Sets the icon used to display ranks.
  * You can choose an icon that matches the game’s concept and theme, such as a medal, soccer ball, or skull.
  * You can also set a custom icon using a 120 × 120 pixel PNG image, in addition to the provided default icons.



### Feature List

The following feature can only be used in **server script** and cannot be called from client.

<table><thead><tr><th width="390">Feature</th><th>Description</th></tr></thead><tbody><tr><td>WorldRankService:IncrementScore(player, delta)</td><td>Uploads the score variance of a specified player to the leaderboard. Score must be an integer, and variance must be a positive number. The maximum allowed variance is 100,000. Any request with a variance exceeding this limit will not be processed.</td></tr><tr><td>WorldRankService:GetScore(player)</td><td>Returns the current score of the player listed on the leaderboard.</td></tr><tr><td>WorldRankService:SetDisplayEnabled(bool)</td><td>Sets whether the ranking and score are displayed above character.</td></tr><tr><td>WorldRankService:GetDisplayEnabled()</td><td>Returns whether the ranking and score are set to be displayed above the character.</td></tr></tbody></table>



### Score Sorting

The scores in the leaderboard are always **listed in descending order**. This cannot be changed.



### Full Code Example

The following code is an example of uploading the **bonus score** player earned during gameplay to the WorldRankService leaderboard when game is over and retrieving and displaying the uploaded **final score** to ResultUI.&#x20;

Please be mindful that the IncrementScore function passes **variance of increased score** instead of the final score to the leaderboard.

```lua
local WorldRankService = game:GetService("WorldRankService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UIRemoteEvent = ReplicatedStorage :WaitForChild("UIRemoteEvent")

local function EndRound(player, eventName, delta)
    print(player, eventName)	
	
		WorldRankService:IncrementScore(player, delta)
		
		local score = WorldRankService:GetScore(player)
		UIRemoteEvent:FireClient(player, "SendMyScoreToResultUI", score)
end
```



### Difference Between Actions in Published and Test Environments

Saves and loads data to and from actual server in mobile environment after game is published. Note that this feature does not work in studio test environment and when called, the `WorldRank API is not available in the editor. It only works in the live game environment.` log will be displayed.



## Ranking and Score Display

If player score is uploaded to the leaderboard, current ranking and score are displayed on top of character.&#x20;

If score is changed, player must **reconnect to world** to see the updated information.

<figure><img src="../../../.gitbook/assets/worldrank-2.png" alt=""><figcaption></figcaption></figure>



The **Top Scorer section** is exposed on the world detail screen of the app (out-game); player rankings and scores of the world are displayed as a list.

<figure><img src="../../../.gitbook/assets/worldrank-1.png" alt=""><figcaption></figcaption></figure>



## Usage Examples

* Convert kills into score and upload it to the leaderboard to fortify competitiveness.
* Provide a goal to players by letting them know that “the top players of this world have achieved this and that score” through the out-game Top Scorer section displayed before players enter their world.
* Build an economic structure in which players are rewarded with skins/costumes based on their accumulated score to promote longer gameplay time.
* Aggregate points in time-limited events to reward top rankers to increase world participation.



## Note

* The value passed to the leaderboard is the **variance of score increase**, not the final score.
* The score uploaded to the leaderboard cannot be **subtracted** nor **deleted (reset)**.
