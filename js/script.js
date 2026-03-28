
function makeFolder() {
	const Items = document.querySelector(".items")
	item = document.createElement("div")
	item.className = "item"
	item.innerHTML = `
	<img class="preview" src="https://cdn-icons-png.freepik.com/256/5577/5577723.png" alt="no preview available because the file is not an image">
	<span class="filename" contenteditable="true"></span>
		<a class="down" href="/"
			><svg viewBox="0 0 24 24" 
		    height="32"
		    width="38" 
		    fill="currentColor" 
		    xmlns="http://www.w3.org/2000/svg">
		    <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
		    <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
		    <g id="SVGRepo_iconCarrier"> <path d="M4 6H20M4 12H20M4 18H20" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
		    </a>`
	Items.append(item)

	const filename = item.querySelector(".filename")
	filename.focus()

	filename.addEventListener("keydown", async (e) => {
		if (e.key === "Enter") {
			e.preventDefault()   // stop newline
			filename.blur()      // exit editing

			filename.contentEditable = "false"
			item.querySelector(".down").href = window.location.pathname + "/" + filename.innerText
			const res = await fetch('/makeFolder', {
				method: "POST",
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name: filename.innerText,
					path: window.location.pathname
				})
			})
			if (!res.ok) {
				console.log("Failed to create folder")
			}
		}
	})
}


function checkFileType(fileName) {
	const Extensions = {
	Images: [".jpg", ".jpeg", ".png", ".gif"],
	Videos: [".mp4", ".mkv", ".mov", ".webm"],
	Audio: [".mp3", ".wav"]
	}

	let isImg = false
	let isVid = false
	let isAudio = false

	const lowerName = fileName.toLowerCase()

	for (const [type, extList] of Object.entries(Extensions)) {
		for (const ext of extList) {
			if (lowerName.endsWith(ext)) {
				if (type === "Images") isImg = true
				else if (type === "Videos") isVid = true
				else if (type === "Audio") isAudio = true
				break
			}
		}
	}

	return { isImg, isVid, isAudio }
}

async function searchFiles(searchInput) {
	const value = searchInput.value
	const res = await fetch(`/search?q=${encodeURIComponent(value)}&path=${window.location.pathname}`)
	try {
		results = await res.json()
		const itemsresult = document.querySelector("#itemsresults")
		
		itemsresult.innerHTML = ""
		console.log(results)

		for (i=0;i<results.length;i++) {
			let path = results[i]
			filename = path.split("/")
			filename = filename[filename.length - 1]
			let source = ""
			svg = ""
			
			folderSVG = `
			<a class="down" href="${path}"
			>
			<svg viewBox="0 0 24 24" 
				height="32"
				width="38" 
				fill="currentColor" 
				xmlns="http://www.w3.org/2000/svg">
				<g id="SVGRepo_bgCarrier" stroke-width="0"></g>
				<g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
				<g id="SVGRepo_iconCarrier">
				<path d="M4 6H20M4 12H20M4 18H20" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
				</g>
			</svg>
			</a>
			`
			otherSVG = `
			<a class="down" href="${path}"
			>
			<svg
				viewBox="0 0 256 256"
				height="32"
				width="38"
				xmlns="http://www.w3.org/2000/svg"
				>
				<path
				d="M74.34 85.66a8 8 0 0 1 11.32-11.32L120 108.69V24a8 8 0 0 1 16 0v84.69l34.34-34.35a8 8 0 0 1 11.32 11.32l-48 48a8 8 0 0 1-11.32 0ZM240 136v64a16 16 0 0 1-16 16H32a16 16 0 0 1-16-16v-64a16 16 0 0 1 16-16h52.4a4 4 0 0 1 2.83 1.17L111 145a24 24 0 0 0 34 0l23.8-23.8a4 4 0 0 1 2.8-1.2H224a16 16 0 0 1 16 16m-40 32a12 12 0 1 0-12 12a12 12 0 0 0 12-12"
				fill="currentColor"
				></path>
			</svg>
			</a>
			`

			const { isImg, isVid, isAudio } = checkFileType(filename)
			if (isImg) {
				source = path
				svg = otherSVG
			} else if (isVid) {
				source = "/videoIcon.png"
				svg = otherSVG

			} else if (isAudio) {
				source = "/audioIcon.png"
				svg = otherSVG

			} else {
				source = "/foldericon.png"
				svg = folderSVG
			}
			
			item = document.createElement("div")
			
			item.innerHTML = `
			<div class="item">
			<img class="preview" src="${source}" alt="no preview available because the file is not an image">
			<span class="filename">${filename}</span>
			
			${svg}

			<ul id="contextMenu" class="context-menu">
				<li onclick="alert('Open')">Move</li>
				<li onclick="Rename(this)">Rename</li>
				<li onclick="Delete(this)">Delete</li>
			</ul>
		</div>
			`
			itemsresult.append(item)
		}
	} catch (e) {
		console.log(e)
	}
}

async function Delete(Button) {
	const Item = Button.parentElement.parentElement
	const DeletePath = Item.querySelector(".Down").href
	const res = await fetch("/delete", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ path: DeletePath })
	})

	if (res.ok) {
		Item.remove()
	}

}
