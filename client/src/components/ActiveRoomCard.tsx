import { useState } from "react";
import { useLocation } from "wouter";
import { Room } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { 
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Copy } from "lucide-react";

interface ActiveRoomCardProps {
  rooms: Room[];
}

export default function ActiveRoomCard({ rooms }: ActiveRoomCardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const closeRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await apiRequest("POST", `/api/rooms/${roomId}/close`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms/active"] });
      toast({
        title: "Room Closed",
        description: "The chat room has been closed."
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to close the room. Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string, type: "code" | "url") => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: "Copied!",
        description: `${type === "code" ? "Room code" : "Share URL"} copied to clipboard.`,
      });
    }).catch(() => {
      toast({
        title: "Failed to copy",
        description: "Please copy the text manually.",
        variant: "destructive",
      });
    });
  };

  return (
    <Card className="bg-card border border-border rounded-lg shadow-md">
      <CardHeader className="px-6 py-4 flex flex-row justify-between items-center">
        <div>
          <CardTitle className="text-xl font-bold">Active Chat Rooms</CardTitle>
          <CardDescription>Your currently active chat sessions</CardDescription>
        </div>
        <span className="bg-emerald-500 text-white text-xs px-3 py-1 rounded-full font-medium">
          {rooms.length} Active
        </span>
      </CardHeader>
      
      <CardContent className="px-6 pb-6 pt-2 space-y-4">
        {rooms.map((room) => (
          <div 
            key={room.id} 
            className="border border-border bg-gradient-to-r from-card to-background rounded-lg p-5 hover:shadow-lg transition-all duration-200"
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-lg text-primary">{room.name}</h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                Created {formatDistanceToNow(new Date(), { addSuffix: true })}
              </span>
            </div>
            
            <div className="flex items-center text-sm text-muted-foreground mb-4">
              <Users className="h-4 w-4 mr-2 text-primary" />
              <span>Room by {room.createdBy}</span>
            </div>
            
            <div className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Room Code:</span>
                <code className="font-mono bg-muted px-3 py-1 rounded text-sm inline-flex items-center">
                  {room.id}
                  <button 
                    className="ml-2 text-primary/70 hover:text-primary transition-colors"
                    onClick={() => copyToClipboard(room.id, "code")}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </code>
              </div>
              
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Share URL:</span>
                <code className="font-mono bg-muted px-3 py-1 rounded text-xs inline-flex items-center max-w-[calc(100%-7rem)] overflow-hidden">
                  <span className="truncate">{`${window.location.origin}/room/${room.id}`}</span>
                  <button 
                    className="ml-2 shrink-0 text-primary/70 hover:text-primary transition-colors"
                    onClick={() => copyToClipboard(`${window.location.origin}/room/${room.id}`, "url")}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </code>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <Button 
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => navigate(`/room/${room.id}`)}
              >
                Enter Chat
              </Button>
              <Button 
                variant="outline"
                className="border-muted-foreground/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                onClick={() => closeRoomMutation.mutate(room.id)}
                disabled={closeRoomMutation.isPending}
              >
                {closeRoomMutation.isPending ? "Closing..." : "Close Room"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
