import React, { useEffect, useState } from "react";
import api from "./api";

export default function AdminPanel({ onClose }) {
	const [users, setUsers] = useState([]);
	const [rooms, setRooms] = useState([]);
	const [saves, setSaves] = useState([]);
	const [stats, setStats] = useState(null);
	const [logs, setLogs] = useState([]);
	const [settings, setSettings] = useState({});
	const [saving, setSaving] = useState(false);
	const [tab, setTab] = useState("users");

	function applyThemePreview(themeValue) {
		const next = String(themeValue || "dark").toLowerCase() === "light" ? "light" : "dark";
		document.documentElement.setAttribute("data-theme", next);
		document.body.classList.remove("theme-dark", "theme-light");
		document.body.classList.add(`theme-${next}`);
	}

	useEffect(() => {
		fetchAll();
	}, []);

	async function fetchAll() {
		try {
			const [usersResponse, roomsResponse, statsResponse, settingsResponse] = await Promise.all([
				api.get("/admin/users"),
				api.get("/admin/rooms"),
				api.get("/admin/stats"),
				api.get("/admin/settings"),
			]);

			setUsers(usersResponse.data.users || usersResponse.data || []);
			setRooms(roomsResponse.data.rooms || roomsResponse.data || []);
			setStats(statsResponse.data || null);
			setSettings(settingsResponse.data || {});

			const savesResponse = await api.get("/admin/saves");
			setSaves(savesResponse.data.saves || savesResponse.data || []);

			const logsResponse = await api.get("/admin/logs?limit=200");
			setLogs(logsResponse.data.logs || logsResponse.data || []);
		} catch (error) {
			console.error(error);
		}
	}

	async function deleteSave(saveId) {
		if (!window.confirm("Изтрий този запис?")) return;
		await api.delete(`/maps/${encodeURIComponent(saveId)}`);
		fetchAll();
	}

	async function approveRoom(roomId) {
		await api.post(`/admin/rooms/${encodeURIComponent(roomId)}/approve`);
		fetchAll();
	}

	async function rejectRoom(roomId) {
		await api.post(`/admin/rooms/${encodeURIComponent(roomId)}/reject`);
		fetchAll();
	}

	async function deleteRoom(roomId) {
		if (!window.confirm("Изтрий тази карта и всички нейни записи?")) return;
		await api.delete(`/admin/rooms/${encodeURIComponent(roomId)}`);
		fetchAll();
	}

	async function saveSettings() {
		setSaving(true);
		try {
			await api.put("/admin/settings", settings);
			applyThemePreview(settings.theme);
			window.dispatchEvent(new CustomEvent("mindmapr-theme-changed", { detail: { theme: settings.theme } }));
			fetchAll();
		} catch (error) {
			console.error(error);
		} finally {
			setSaving(false);
		}
	}

	const cardStyle = {
		background: "rgba(255,255,255,.04)",
		padding: 10,
		borderRadius: 8,
		border: "1px solid rgba(255,255,255,.10)",
	};

	const fieldStyle = {
		width: "100%",
		padding: 6,
		borderRadius: 6,
		border: "1px solid rgba(255,255,255,.12)",
		background: "rgba(255,255,255,.07)",
		color: "#e9eeff",
	};

	const tabButtonStyle = {
		width: "100%",
		padding: "10px 8px",
		whiteSpace: "nowrap",
	};

	const tabContentWrapStyle = {
		flex: 1,
		minHeight: 0,
		overflow: "hidden",
	};

	const tabSectionStyle = {
		height: "100%",
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
	};

	const tabScrollAreaStyle = {
		flex: 1,
		minHeight: 0,
		overflow: "auto",
		border: "1px solid rgba(255,255,255,.10)",
		borderRadius: 12,
		background: "rgba(255,255,255,.04)",
	};

	return (
		<div
			style={{
				position: "absolute",
				right: 18,
				top: 62,
				bottom: 14,
				left: 380,
				background: "rgba(18,26,46,.92)",
				padding: 24,
				borderRadius: "18px",
				boxShadow: "0 18px 55px rgba(0,0,0,.35)",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				minHeight: 0,
				minWidth: 520,
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
				<h3 style={{ fontWeight: 800, letterSpacing: ".2px", color: "#dfe6ff" }}>Администраторски панел</h3>
				<button className="btn ghost" onClick={onClose} style={{ fontWeight: 700 }}>✖</button>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, marginBottom: 16 }}>
				<button style={tabButtonStyle} className={tab === "users" ? "btn primary" : "btn ghost"} onClick={() => setTab("users")}>Потребители</button>
				<button style={tabButtonStyle} className={tab === "rooms" ? "btn primary" : "btn ghost"} onClick={() => setTab("rooms")}>Карти</button>
				<button style={tabButtonStyle} className={tab === "saves" ? "btn primary" : "btn ghost"} onClick={() => setTab("saves")}>Записи</button>
				<button style={tabButtonStyle} className={tab === "stats" ? "btn primary" : "btn ghost"} onClick={() => setTab("stats")}>Статистика</button>
				<button style={tabButtonStyle} className={tab === "logs" ? "btn primary" : "btn ghost"} onClick={() => setTab("logs")}>Логове</button>
				<button style={tabButtonStyle} className={tab === "settings" ? "btn primary" : "btn ghost"} onClick={() => setTab("settings")}>Настройки</button>
			</div>

			<div style={tabContentWrapStyle}>

			{tab === "users" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Потребители</h4>
					<div style={tabScrollAreaStyle}>
						<table style={{ width: "100%", fontSize: 13 }}>
							<thead style={{ background: "rgba(124,92,255,.18)" }}>
								<tr><th>ID</th><th>Email</th><th>Username</th><th>Role</th></tr>
							</thead>
							<tbody>
								{(users || []).map((user) => (
									<tr key={user.id} style={{ background: user.role === "admin" ? "rgba(38,209,167,.12)" : "none" }}>
										<td>{user.id}</td>
										<td>{user.email}</td>
										<td>{user.username}</td>
										<td>{user.role}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{tab === "rooms" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Карти / Стаи</h4>
					<div style={tabScrollAreaStyle}>
						<table style={{ width: "100%", fontSize: 13 }}>
							<thead style={{ background: "rgba(124,92,255,.18)" }}>
								<tr><th>Room</th><th>Name</th><th>Статус</th><th>Записи</th><th>Actions</th></tr>
							</thead>
							<tbody>
								{(rooms || []).map((room) => (
									<tr key={room.room_id}>
										<td>{room.room_id}</td>
										<td>{room.name || "(без име)"}</td>
										<td>
											{room.approval_status === "approved"
												? "✅ Одобрена"
												: room.approval_status === "rejected"
												? "❌ Отказана"
												: "⏳ Чака одобрение"}
										</td>
										<td>{room.saves_count || 0}</td>
										<td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
											{room.approval_status !== "approved" ? (
												<button className="btn ghost" style={{ fontSize: 12 }} onClick={() => approveRoom(room.room_id)}>✔ Одобри</button>
											) : null}
											{room.approval_status !== "rejected" ? (
												<button className="btn ghost" style={{ fontSize: 12 }} onClick={() => rejectRoom(room.room_id)}>✖ Откажи</button>
											) : null}
											<button className="btn warn" style={{ fontSize: 12 }} onClick={() => deleteRoom(room.room_id)}>🗑 Изтрий</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{tab === "saves" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Записи на картите</h4>
					<div style={tabScrollAreaStyle}>
						<table style={{ width: "100%", fontSize: 13 }}>
							<thead style={{ background: "rgba(124,92,255,.18)" }}>
								<tr><th>ID</th><th>Room</th><th>User</th><th>Дата</th><th>Actions</th></tr>
							</thead>
							<tbody>
								{(saves || []).map((save) => (
									<tr key={save.id}>
										<td>{save.id}</td>
										<td>{save.room_id}</td>
										<td>{save.saved_by_email || save.saved_by_username || save.saved_by || "-"}</td>
										<td>{save.created_at ? new Date(save.created_at).toLocaleString() : "-"}</td>
										<td>
											<button className="btn warn" style={{ fontSize: 12 }} onClick={() => deleteSave(save.id)}>🗑 Изтрий</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{tab === "stats" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Статистика</h4>
					<div style={{ ...tabScrollAreaStyle, padding: 12, fontSize: 13 }}>
						<div><b>Активни потребители:</b> {stats?.activeUsers || 0}</div>
						<div style={{ marginTop: 8 }}><b>Популярни карти:</b></div>
						<ul style={{ margin: 0, paddingLeft: 18 }}>{stats?.popularMaps?.map((item) => <li key={item.room_id}>{item.room_id} ({item.saves} записа)</li>)}</ul>
						<div style={{ marginTop: 8 }}><b>Ключови думи:</b></div>
						<ul style={{ margin: 0, paddingLeft: 18 }}>{stats?.keywords?.map((item) => <li key={item.keyword}>{item.keyword} ({item.count})</li>)}</ul>
					</div>
				</section>
			)}

			{tab === "logs" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Логове (последни 200)</h4>
					<div style={tabScrollAreaStyle}>
						<table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
							<thead style={{ background: "rgba(124,92,255,.18)" }}>
								<tr>
									<th style={{ textAlign: "left", padding: "10px 10px" }}>Дата</th>
									<th style={{ textAlign: "left", padding: "10px 10px" }}>Потребител</th>
									<th style={{ textAlign: "left", padding: "10px 10px" }}>Действие</th>
									<th style={{ textAlign: "left", padding: "10px 10px" }}>Детайли</th>
									<th style={{ textAlign: "left", padding: "10px 10px" }}>IP</th>
								</tr>
							</thead>
							<tbody>
								{(logs || []).map((log) => (
									<tr key={log.id} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
										<td style={{ padding: "10px 10px", whiteSpace: "nowrap", opacity: .9 }}>{log.created_at ? new Date(log.created_at).toLocaleString() : "-"}</td>
										<td style={{ padding: "10px 10px", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: .9 }} title={log.user_email || ""}>{log.user_email || log.user_username || log.user_id || "—"}</td>
										<td style={{ padding: "10px 10px", whiteSpace: "nowrap" }}>{log.action}</td>
										<td style={{ padding: "10px 10px", maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: .9 }} title={log.details || ""}>{log.details || "—"}</td>
										<td style={{ padding: "10px 10px", whiteSpace: "nowrap", opacity: .85 }}>{log.ip || "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{tab === "settings" && (
				<section style={tabSectionStyle}>
					<h4 style={{ margin: "8px 0" }}>Настройки на системата</h4>
					<div style={{ ...tabScrollAreaStyle, padding: 12 }}>
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Режим на поддръжка</div>
							<select value={settings.maintenanceMode ? "on" : "off"} onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.value === "on" })} style={fieldStyle}>
								<option value="off">Изключен</option>
								<option value="on">Включен</option>
							</select>
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Макс. записи на потребител</div>
							<input type="number" min="1" max="1000" value={settings.maxSavesPerUser || 100} onChange={(e) => setSettings({ ...settings, maxSavesPerUser: parseInt(e.target.value, 10) || 100 })} style={fieldStyle} />
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Макс. участници в стая</div>
							<input type="number" min="1" max="500" value={settings.maxRoomUsers || 50} onChange={(e) => setSettings({ ...settings, maxRoomUsers: parseInt(e.target.value, 10) || 50 })} style={fieldStyle} />
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Изтичане на сесия (мин.)</div>
							<input type="number" min="5" max="10080" value={settings.sessionTimeout || 480} onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value, 10) || 480 })} style={fieldStyle} />
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Публични карти</div>
							<select value={settings.publicMapsApproval ? "manual" : "auto"} onChange={(e) => setSettings({ ...settings, publicMapsApproval: e.target.value === "manual" })} style={fieldStyle}>
								<option value="auto">Автоматично</option>
								<option value="manual">Ръчно одобрение</option>
							</select>
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Макс. възли на карта</div>
							<input type="number" min="10" max="10000" value={settings.maxNodesPerMap || 1000} onChange={(e) => setSettings({ ...settings, maxNodesPerMap: parseInt(e.target.value, 10) || 1000 })} style={fieldStyle} />
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Логване</div>
							<select value={settings.enableLogging ? "on" : "off"} onChange={(e) => setSettings({ ...settings, enableLogging: e.target.value === "on" })} style={fieldStyle}>
								<option value="on">Включено</option>
								<option value="off">Изключено</option>
							</select>
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Тема</div>
							<select
								value={settings.theme || "dark"}
								onChange={(e) => {
									setSettings({ ...settings, theme: e.target.value });
									applyThemePreview(e.target.value);
									window.dispatchEvent(new CustomEvent("mindmapr-theme-changed", { detail: { theme: e.target.value } }));
								}}
								style={fieldStyle}
							>
								<option value="dark">Тъмна</option>
								<option value="light">Светла</option>
							</select>
						</label>

						<label style={cardStyle}>
							<div style={{ fontWeight: 600, marginBottom: 4, color: "#dfe6ff" }}>Език</div>
							<select value={settings.lang || "bg"} onChange={(e) => setSettings({ ...settings, lang: e.target.value })} style={fieldStyle}>
								<option value="bg">Български</option>
								<option value="en">English</option>
								<option value="ru">Русский</option>
							</select>
						</label>
						</div>

						<div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
							<button className="btn primary" onClick={saveSettings} disabled={saving} style={{ fontSize: 13, padding: "10px 16px", width: "auto" }}>
								{saving ? "Запазване..." : "Запази настройки"}
							</button>
							<button className="btn ghost" onClick={fetchAll} style={{ fontSize: 13, padding: "10px 16px", width: "auto" }}>Презареди</button>
						</div>
					</div>
				</section>
			)}
			</div>
		</div>
	);
}
