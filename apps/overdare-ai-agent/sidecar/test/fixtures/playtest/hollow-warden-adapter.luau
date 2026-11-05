--!nonstrict
-- Source-backed sample UGC adapter. The generic Diligent runtime has no raid rules.
local Players=game:GetService('Players')
local RS=game:GetService('ReplicatedStorage')
local player=Players.LocalPlayer
local raid=nil
local lobby=nil
local logs={}
local logSequence=0
local Adapter={}

local function note(message: string,data: any)
	logSequence+=1
	table.insert(logs,{id='game-'..tostring(logSequence),level='info',message=message,data=data})
	if #logs>16 then table.remove(logs,1) end
end
function Adapter.start()
	local shared=RS:WaitForChild('Raid')
	local preparation=RS:WaitForChild('Lobby')
	shared.Snapshot.OnClientEvent:Connect(function(data: any)
		if type(data)=='table' and type(data.revision)=='number' and (not raid or data.revision>raid.revision) then raid=table.clone(data) end
	end)
	preparation.Snapshot.OnClientEvent:Connect(function(data: any)
		if type(data)=='table' and data.kind=='state' and type(data.revision)=='number' and (not lobby or data.revision>lobby.revision) then lobby=table.clone(data) end
	end)
	shared.Feedback.OnClientEvent:Connect(function(data: any)
		if type(data)=='table' then note('Server feedback',{kind=data.kind,hit=data.hit,round=data.round}) end
	end)
	shared.Intent:FireServer({action='sync'})
	preparation.Intent:FireServer({action='sync'})
end
local function key(k: string,ms: number): any
	return {type='key',key=k,action='press',durationMs=ms}
end
local function click(path: string): any
	return {{type='pointerMove',target=path},{type='pointerButton',button='left',action='press',durationMs=60}}
end
local function childPath(root: any,path: string): any
	local item=root
	for _,name in ipairs(string.split(path,'.')) do item=item and item:FindFirstChild(name) end
	return item
end
local function visible(path: string): boolean
	local pg=player:FindFirstChild('PlayerGui')
	local item=pg and childPath(pg,path)
	if not item then return false end
	local cursor=item
	while cursor and cursor~=pg do
		if cursor:IsA('ScreenGui') and not cursor.Enabled then return false end
		if cursor:IsA('GuiObject') and not cursor.Visible then return false end
		cursor=cursor.Parent
	end
	return true
end
local function add(actions: any,id: string,description: string,events: any,expectations: any?)
	table.insert(actions,{id=id,description=description,events=events,validityKey=tostring(raid and raid.round or 0)..':'..tostring(raid and raid.phase or 'lobby')..':'..id,expiresAtGameTime=os.clock()+0.5,expectations=expectations})
end
local function inside(spec: any,x: number,z: number): boolean
	local dx,dz=x-spec.x,z-spec.z
	return if spec.kind=='disc' then dx*dx+dz*dz<=(spec.radius+65)^2 else math.abs(dx)<=spec.width/2+65 and math.abs(dz)<=spec.depth/2+65
end
local function hazards(): any
	local out={}
	local folder=workspace:FindFirstChild('RaidHazards')
	if folder then
		for _,part in ipairs(folder:GetChildren()) do
			if string.sub(part.Name,1,8)=='Warning_' then
				local pos=part.Position; local size=part.Size
				table.insert(out,{kind=if part.Name=='Warning_disc' then 'disc' else 'box',x=pos.X,z=pos.Z,width=size.X,depth=size.Z,radius=size.X/2})
			end
		end
	end
	return out
end
local function unsafe(specs: any,x: number,z: number): boolean
	for _,spec in ipairs(specs) do if inside(spec,x,z) then return true end end
	return false
end
local function escape(actions: any,root: any,camera: any,specs: any)
	local pos=root.Position
	local directions={{id='left',key='A',v=-camera.CFrame.RightVector},{id='right',key='D',v=camera.CFrame.RightVector},{id='forward',key='W',v=camera.CFrame.LookVector},{id='back',key='S',v=-camera.CFrame.LookVector}}
	local options={}
	for _,d in ipairs(directions) do
		local flat=Vector3.new(d.v.X,0,d.v.Z)
		if flat.Magnitude>0.01 then
			local v=flat.Unit
			local movementAxis=if math.abs(v.X)>=math.abs(v.Z) then 'x' else 'z'
			for distance=80,840,40 do
				local dest=pos+v*distance
				if Vector3.new(dest.X,0,dest.Z).Magnitude>1635 then break end
				if not unsafe(specs,dest.X,dest.Z) then
					local ms=math.clamp(math.floor(distance/(raid.walkSpeed or 500)*1000),100,500)
					table.insert(options,{distance=distance,axis=movementAxis,id='escape_'..d.id,description='Move '..tostring(distance)..' units '..d.id..' toward a currently hazard-free point.',events={key(d.key,ms)}})
					local endRoll=pos+v*300
					if not raid.aim and (raid.rollCooldown or 1)<=0 and (raid.rollRemaining or 0)<=0 and Vector3.new(endRoll.X,0,endRoll.Z).Magnitude<1635 and not unsafe(specs,endRoll.X,endRoll.Z) then
						table.insert(options,{distance=300,axis=movementAxis,id='roll_'..d.id,description='Directional roll '..d.id..' toward a currently hazard-free endpoint.',events={{type='key',key=d.key,action='down'},{type='wait',durationMs=60},key('Q',20),{type='wait',durationMs=270},{type='key',key=d.key,action='up'}}})
					end
					break
				end
			end
		end
	end
	table.sort(options,function(a: any,b: any) return a.distance<b.distance end)
	for index=1,math.min(4,#options) do local d=options[index]; add(actions,d.id,d.description,d.events,{{key=d.axis,op='change'}}) end
end
local function burst(shots: number): any
	local events={}
	for index=1,shots do
		if index>1 then table.insert(events,{type='wait',durationMs=170}) end
		table.insert(events,key('F',20))
	end
	return events
end
function Adapter.observe(): any
	local actions={}
	local state={mode='loading'}
	if not lobby or not raid then return {state=state,actions=actions,events=logs} end
	if not raid.inRaid then
		state={mode='lobby',phase=lobby.phase,ready=lobby.ready,canDeploy=lobby.canDeploy,weapon=lobby.weapon,kit=lobby.kit}
		if lobby.phase=='LOBBY' then
			if not visible('LobbyHUD.Console') then add(actions,'open_equipment','Open the preparation console.',click('PlayerGui.LobbyHUD.Equipment'))
			elseif lobby.ready and lobby.canDeploy then add(actions,'deploy','Deploy the prepared roster into the raid.',click('PlayerGui.LobbyHUD.Console.Deploy'),{{key='mode',op='change'}})
			elseif not lobby.ready then add(actions,'ready','Ready the current equipment for deployment.',click('PlayerGui.LobbyHUD.Console.Ready'),{{key='ready',op='equals',value=true}}) end
		end
		return {state=state,actions=actions,events=logs}
	end
	local character=player.Character
	local root=character and character:FindFirstChild('HumanoidRootPart')
	local camera=workspace.CurrentCamera
	state={mode='raid',phase=raid.phase,round=raid.round,bossHp=raid.hp,playerHp=raid.playerHp,ammo=raid.ammo,reload=raid.reload,aim=raid.aim,rollCooldown=raid.rollCooldown,remaining=raid.remaining}
	if root then state.x=math.round(root.Position.X); state.z=math.round(root.Position.Z) end
	if raid.phase=='VICTORY' or raid.phase=='WIPE' then
		return {state=state,actions=actions,events=logs,terminal={outcome=if raid.phase=='VICTORY' then 'success' else 'failure',reason=raid.phase..': boss HP '..tostring(raid.hp)..', player HP '..tostring(raid.playerHp)}}
	end
	if not root or not camera or not raid.alive then return {state=state,actions=actions,events=logs} end
	local danger=hazards()
	if unsafe(danger,root.Position.X,root.Position.Z) then
		if raid.aim then add(actions,'aim_off','Leave precision aim so normal movement and roll are available.',{key('V',20)},{{key='aim',op='equals',value=false}})
		else escape(actions,root,camera,danger) end
		return {state=state,actions=actions,events=logs}
	end
	if (raid.reload or 0)<=0 and raid.ammo<raid.magazine and (raid.phase~='EXPOSED' or raid.ammo<3) then add(actions,'reload','Refill missing ammunition away from current hazards.',{key('R',20)},{{key='reload',op='increase'}}) end
	if raid.phase=='EXPOSED' and raid.ammo>0 and (raid.reload or 0)<=0 and (raid.rollRemaining or 0)<=0 then
		if not raid.aim then add(actions,'aim_on','Enter accurate first-person aim for the exposed core.',{key('V',20)},{{key='aim',op='equals',value=true}})
		else
			local boss=workspace:FindFirstChild('Warden'); local core=boss and boss:FindFirstChild('CoreHitbox')
			if core then
				local delta=core.Position-camera.CFrame.Position; local look=camera.CFrame.LookVector
				local yaw=(math.deg(math.atan2(-delta.X,-delta.Z))-math.deg(math.atan2(-look.X,-look.Z))+180)%360-180
				local pitch=math.deg(math.asin(math.clamp(delta.Y/delta.Magnitude,-1,1)))-math.deg(math.asin(math.clamp(look.Y,-1,1)))
				if math.max(math.abs(yaw),math.abs(pitch))>1.5 then add(actions,'align_core','Align the player camera to the live CoreHitbox.',{{type='look',yawDegrees=yaw,pitchDegrees=math.clamp(pitch,-89,89),timeoutMs=700}})
				else
					add(actions,'fire_core','Fire up to three aligned shots at the exposed core; takes about 0.4 seconds.',burst(math.min(3,raid.ammo)),{{key='bossHp',op='decrease'}})
					if raid.ammo>1 then add(actions,'single_core','Fire one aligned shot and quickly recover control to track boss motion.',burst(1),{{key='bossHp',op='decrease'}}) end
				end
			end
		end
	elseif raid.aim then add(actions,'aim_off','Leave precision aim while the boss is armored.',{key('V',20)},{{key='aim',op='equals',value=false}}) end
	return {state=state,actions=actions,events=logs}
end
return Adapter
