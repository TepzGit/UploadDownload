// Shared by the Files and Upload pages.

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

function byteConverter(size) {
	const divider = 1024
	if (size > 1000000000) {
	    size = size / (divider * divider * divider);
	    size = Math.round(size).toString() + ' GB';
	} else if (size > 1000000) {
	    size = size / (divider * divider);
	    size = Math.round(size).toString() + ' MB';
	} else if (size > 1000) {
	    size = size / divider;
	    size = Math.round(size).toString() + ' KB';
	} else {
	    size = size.toString() + ' bytes';
	}
	return size
}

// ------------------------------------------------------------
// Files page (html/Downloader.html). Rows are rendered by the server;
// search results and new folders are built here with the same markup.
// ------------------------------------------------------------
(function () {
	const TYPE_ICON = { Dir: "i-folder", Image: "i-image", Video: "i-video", Audio: "i-audio", None: "i-file" }
async function searchFiles(searchInput) {
	const value = searchInput.value
	const res = await fetch(`/search?q=${encodeURIComponent(value)}&path=${window.location.pathname}`)
	console.log(`/search?q=${encodeURIComponent(value)}&path=${window.location.pathname}`)
	try {
		results = await res.json()
		const itemsresult = document.querySelector("#itemsresults")
		
		itemsresult.innerHTML = ""

	function toast(message, isError) {
		if (window.xnToast) window.xnToast(message, isError)
		else alert(message)
	}

	function esc(text) {
		return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
	}

	function icon(id, extra) {
		return `<svg class="fx-ico${extra ? " " + extra : ""}" aria-hidden="true"><use href="#${id}"/></svg>`
	}

	function formatDate(value) {
		const d = new Date(value)
		if (isNaN(d)) return ""
		const pad = (n) => String(n).padStart(2, "0")
		return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear()
	}

	function entryType(entry) {
		if (entry.IsDir) return "Dir"
		if (entry.IsImg) return "Image"
		if (entry.IsVid) return "Video"
		if (entry.IsAudio) return "Audio"
		return "None"
	}

	// Folder of a search hit, e.g. "/Files/Photos/a.jpg" -> "Photos".
	function folderOf(path) {
		const parts = decodeURIComponent(path).split("/").slice(2, -1)
		return parts.join("/")
	}

	function itemHTML(entry, showFolder) {
		const type = entryType(entry)
		const name = esc(entry.Name)
		const path = esc(entry.Path)
		const thumb = type === "Image"
			? `<img class="preview" src="${path}" alt="" loading="lazy" decoding="async">`
			: icon(TYPE_ICON[type])
		let meta = "Folder"
		if (type !== "Dir") {
			meta = `<span class="uploadtime">${formatDate(entry.Date)}</span> · <span class="filesize">${byteConverter(entry.Size || 0)}</span>`
			const folder = showFolder ? folderOf(entry.Path) : ""
			if (folder) meta += ` · in ${esc(folder)}`
		}
		const action = type === "Dir"
			? icon("i-chevron", "fx-chev")
			: `<a class="down" href="${path}" download aria-label="Download ${name}">${icon("i-download")}</a>`
		return `<div class="item" tabindex="0" data-path="${path}" data-type="${type}">
			<span class="fx-thumb">${thumb}</span>
			<span class="fileinfo"><span class="filename">${name}</span><span class="fx-meta">${meta}</span></span>
			<span class="fx-row-actions">${action}<button type="button" class="fx-more" aria-label="More actions for ${name}" aria-haspopup="menu">${icon("i-more")}</button></span>
		</div>`
	}

	// "/Files/" or "/Files/Photos/" -> "/Files" or "/Files/Photos"
	function currentFolderPath() {
		return window.location.pathname.replace(/\/+$/, "")
	}

	function postJSON(url, body) {
		return fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}).then((res) => res.ok, () => false)
	}

	function invalidName(name) {
		return !name || name === "." || name === ".." || /[\\/]/.test(name)
	}

	function init() {
		const list = document.getElementById("itemsresults")
		if (!list) return

		const menu = document.getElementById("fxMenu")
		const modal = document.getElementById("previewModal")
		const modalName = document.getElementById("modalName")
		const modalDownload = document.getElementById("modalDownload")
		const modalImage = document.getElementById("modalImage")
		const modalVideo = document.getElementById("modalVideo")
		const modalAudio = document.getElementById("modalAudio")
		const modalNone = document.getElementById("modalNone")
		const closeModal = document.getElementById("closeModal")
		const searchInput = document.getElementById("search")

		list.querySelectorAll(".filesize[data-bytes]").forEach((el) => {
			el.textContent = byteConverter(Number(el.dataset.bytes) || 0)
		})

		renderCrumbs()

		function renderCrumbs() {
			const nav = document.getElementById("fxCrumbs")
			if (!nav) return
			const parts = currentFolderPath().split("/").slice(2)
			let href = "/Files"
			let html = parts.length ? `<a href="/Files/">Files</a>` : `<span aria-current="page">Files</span>`
			parts.forEach((part, i) => {
				href += "/" + part
				const label = esc(decodeURIComponent(part))
				html += `<span class="fx-sep" aria-hidden="true">/</span>`
				html += i === parts.length - 1 ? `<span aria-current="page">${label}</span>` : `<a href="${esc(href)}">${label}</a>`
			})
			nav.innerHTML = html
		}

		function showEmpty(text) {
			if (list.querySelector(".item")) return
			list.innerHTML = `<p class="xn-empty fx-empty">${esc(text)}</p>`
		}

		// ---------- open / preview ----------
		let lastFocus = null

		function openItem(item) {
			const type = item.dataset.type
			if (type === "Dir") {
				window.location.href = item.dataset.path
				return
			}
			lastFocus = item
			const path = item.dataset.path
			modalName.textContent = item.querySelector(".filename").textContent
			modalDownload.href = path
			modalImage.hidden = type !== "Image"
			modalVideo.hidden = type !== "Video"
			modalAudio.hidden = type !== "Audio"
			modalNone.hidden = type !== "None"
			if (type === "Image") modalImage.src = path
			if (type === "Video") modalVideo.src = path
			if (type === "Audio") modalAudio.src = path
			modal.hidden = false
			document.documentElement.classList.add("xn-modal-open")
			closeModal.focus()
		}

		function closePreview() {
			if (modal.hidden) return
			modal.hidden = true
			document.documentElement.classList.remove("xn-modal-open")
			;[modalVideo, modalAudio].forEach((media) => {
				media.pause()
				media.removeAttribute("src")
				media.load()
			})
			modalImage.removeAttribute("src")
			if (lastFocus && document.contains(lastFocus)) lastFocus.focus()
		}

		closeModal.addEventListener("click", closePreview)
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closePreview()
		})

		// ---------- row menu ----------
		let menuItem = null

		function openMenu(item, x, y) {
			menuItem = item
			const isDir = item.dataset.type === "Dir"
			menu.querySelector('[data-act="open"]').textContent = isDir ? "Open" : "Preview"
			menu.querySelector('[data-act="download"]').hidden = isDir
			menu.hidden = false
			const rect = menu.getBoundingClientRect()
			const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
			const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y
			menu.style.left = left + "px"
			menu.style.top = top + "px"
			menu.querySelector("button:not([hidden])").focus({ preventScroll: true })
		}

		function closeMenu() {
			if (menu.hidden) return
			menu.hidden = true
			menuItem = null
		}

		menu.addEventListener("click", (e) => {
			const button = e.target.closest("button[data-act]")
			if (!button || !menuItem) return
			const item = menuItem
			closeMenu()
			const act = button.dataset.act
			if (act === "open") openItem(item)
			else if (act === "download") window.location.href = item.dataset.path
			else if (act === "rename") startRename(item)
			else if (act === "delete") deleteItem(item)
		})

		document.addEventListener("click", (e) => {
			if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".fx-more")) closeMenu()
		})
		window.addEventListener("resize", closeMenu)
		window.addEventListener("scroll", closeMenu, { passive: true })

		// ---------- list events (work for search results too) ----------
		list.addEventListener("click", (e) => {
			const item = e.target.closest(".item")
			if (!item || item.classList.contains("is-editing")) return
			const more = e.target.closest(".fx-more")
			if (more) {
				e.preventDefault()
				if (menuItem === item) return closeMenu()
				const r = more.getBoundingClientRect()
				openMenu(item, r.right - 180, r.bottom + 4)
				return
			}
			if (e.target.closest(".down")) return // plain download link
			openItem(item)
		})

		list.addEventListener("contextmenu", (e) => {
			const item = e.target.closest(".item")
			if (!item || item.classList.contains("is-editing")) return
			e.preventDefault()
			openMenu(item, e.clientX, e.clientY)
		})

		list.addEventListener("keydown", (e) => {
			const item = e.target.closest(".item")
			if (!item || e.target !== item) return
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault()
				openItem(item)
			} else if (e.key === "Delete") {
				e.preventDefault()
				deleteItem(item)
			} else if (e.key === "F2") {
				e.preventDefault()
				startRename(item)
			}
		})

		document.addEventListener("keydown", (e) => {
			if (e.key !== "Escape") return
			if (!menu.hidden) closeMenu()
			else closePreview()
		})

		// ---------- rename ----------
		function nameEditor(initial, onDone) {
			const input = document.createElement("input")
			input.type = "text"
			input.className = "xn-input fx-rename"
			input.value = initial
			input.setAttribute("enterkeyhint", "done")
			input.setAttribute("autocapitalize", "off")
			input.setAttribute("spellcheck", "false")
			let done = false
			const finish = (save) => {
				if (done) return
				done = true
				onDone(save ? input.value.trim() : null)
			}
			input.addEventListener("keydown", (e) => {
				e.stopPropagation()
				if (e.key === "Enter") { e.preventDefault(); finish(true) }
				else if (e.key === "Escape") { e.preventDefault(); finish(false) }
			})
			input.addEventListener("blur", () => finish(true))
			input.addEventListener("click", (e) => e.stopPropagation())
			return input
		}

		function startRename(item) {
			const nameEl = item.querySelector(".filename")
			const oldName = nameEl.textContent
			item.classList.add("is-editing")
			const input = nameEditor(oldName, async (newName) => {
				input.remove()
				nameEl.hidden = false
				item.classList.remove("is-editing")
				if (!newName || newName === oldName) return
				if (invalidName(newName)) return toast("A name can't contain / or \\.", true)
				const ok = await postJSON("/rename", { currentFilenamePath: item.dataset.path, newFileName: newName })
				if (!ok) return toast(`Couldn't rename “${oldName}”. A file with that name may already exist.`, true)
				const newPath = item.dataset.path.replace(/[^/]*$/, encodeURIComponent(newName))
				nameEl.textContent = newName
				item.dataset.path = newPath
				const down = item.querySelector(".down")
				if (down) {
					down.href = newPath
					down.setAttribute("aria-label", "Download " + newName)
				}
				const img = item.querySelector(".preview")
				if (img) img.src = newPath
				item.querySelector(".fx-more").setAttribute("aria-label", "More actions for " + newName)
				toast(`Renamed to “${newName}”.`)
			})
			nameEl.hidden = true
			nameEl.after(input)
			input.focus()
			const dot = oldName.lastIndexOf(".")
			input.setSelectionRange(0, item.dataset.type !== "Dir" && dot > 0 ? dot : oldName.length)
		}

		// ---------- delete ----------
		async function deleteItem(item) {
			const name = item.querySelector(".filename").textContent
			const isDir = item.dataset.type === "Dir"
			if (!confirm(`Delete “${name}”?${isDir ? " Only empty folders can be deleted." : ""}`)) return
			const ok = await postJSON("/delete", { path: item.dataset.path })
			if (!ok) return toast(isDir ? `Couldn't delete “${name}”. Empty the folder first.` : `Couldn't delete “${name}”.`, true)
			item.remove()
			toast(`Deleted “${name}”.`)
			showEmpty("This folder is empty. Upload something or make a new folder.")
		}

		// ---------- new folder ----------
		document.getElementById("fxNewFolder").addEventListener("click", () => {
			if (list.querySelector(".fx-new")) return list.querySelector(".fx-new input").focus()
			const row = document.createElement("div")
			row.className = "item fx-new is-editing"
			row.innerHTML = `<span class="fx-thumb">${icon("i-folder")}</span><span class="fileinfo"></span>`
			const input = nameEditor("", async (name) => {
				row.remove()
				if (!name) return showEmpty("This folder is empty. Upload something or make a new folder.")
				if (invalidName(name)) return toast("A name can't contain / or \\.", true)
				const ok = await postJSON("/makeFolder", { name, path: decodeURIComponent(currentFolderPath()) })
				if (!ok) return toast(`Couldn't make the folder “${name}”.`, true)
				list.querySelector(".fx-empty")?.remove()
				list.insertAdjacentHTML("afterbegin", itemHTML({ Name: name, Path: currentFolderPath() + "/" + encodeURIComponent(name), IsDir: true }))
				toast(`Made the folder “${name}”.`)
			})
			input.placeholder = "Folder name"
			row.querySelector(".fileinfo").append(input)
			list.querySelector(".fx-empty")?.remove()
			list.prepend(row)
			input.focus()
		})

		// ---------- search ----------
		let searchTimer = 0
		let searchSeq = 0
		searchInput.addEventListener("input", () => {
			clearTimeout(searchTimer)
			searchTimer = setTimeout(runSearch, 200)
		})

		async function runSearch() {
			const query = searchInput.value.trim()
			const seq = ++searchSeq
			let results
			try {
				const res = await fetch(`/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(decodeURIComponent(currentFolderPath()))}`)
				if (!res.ok) throw new Error(res.status)
				results = await res.json()
			} catch (e) {
				if (seq === searchSeq) toast("Search didn't work. Try again.", true)
				return
			}
			if (seq !== searchSeq) return // a newer search is on its way
			closeMenu()
			list.innerHTML = (results || []).map((entry) => itemHTML(entry, !!query)).join("")
			if (!list.children.length) {
				showEmpty(query ? `No files match “${query}”.` : "This folder is empty. Upload something or make a new folder.")
			}
		}
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init)
	else init()
})()
