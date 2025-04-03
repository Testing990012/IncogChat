import { format } from "date-fns";

// Format date and time for display
export function formatDateTime(date: Date): string {
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

// Format room code for display
export function formatRoomCode(code: string): string {
  if (!code.includes("-") && code.length >= 8) {
    // If it's a raw code without format, add a dash in the middle
    const middle = Math.floor(code.length / 2);
    return `${code.slice(0, middle)}-${code.slice(middle)}`;
  }
  return code;
}

// Get nickname from localStorage
export function getNickname(): string {
  return localStorage.getItem("chatvault-nickname") || "";
}

// Save nickname to localStorage
export function saveNickname(nickname: string): void {
  localStorage.setItem("chatvault-nickname", nickname);
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map(part => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Generate shareable room link
export function getRoomShareLink(roomId: string): string {
  return `${window.location.origin}/room/${roomId}`;
}
