import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { 
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface JoinChatFormProps {
  nickname: string;
  onSetNickname: (name: string) => void;
}

export default function JoinChatForm({ nickname, onSetNickname }: JoinChatFormProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [roomCode, setRoomCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname) {
      toast({
        title: "Nickname Required",
        description: "Please enter a nickname to join a chat room.",
        variant: "destructive",
      });
      return;
    }
    
    if (!roomCode) {
      toast({
        title: "Room Code Required",
        description: "Please enter a room code to join.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Prefetch the room data to verify it exists
      await queryClient.fetchQuery({
        queryKey: [`/api/rooms/${roomCode}`],
      });
      
      navigate(`/room/${roomCode}`);
    } catch (error) {
      toast({
        title: "Room Not Found",
        description: "The room code you entered doesn't exist or has expired.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-white rounded-lg shadow-md p-6 mb-8">
      <CardHeader className="p-0 pb-4">
        <CardTitle className="font-secondary text-xl md:text-2xl font-bold">Join Chat Room</CardTitle>
        <CardDescription className="text-secondary">
          Enter a room code to join an existing chat room.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-0">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="join-nickname" className="block text-sm font-medium text-secondary mb-1">
              Your Display Name
            </Label>
            <Input
              type="text"
              id="join-nickname"
              value={nickname}
              onChange={(e) => onSetNickname(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md"
              placeholder="Enter a nickname"
              required
            />
          </div>
          
          <div className="mb-5">
            <Label htmlFor="room-code" className="block text-sm font-medium text-secondary mb-1">
              Room Code
            </Label>
            <Input
              type="text"
              id="room-code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-neutral-dark rounded-md font-mono"
              placeholder="Enter room code (e.g. TEAM-1234)"
              required
            />
          </div>
          
          <Button 
            type="submit" 
            className="w-full bg-accent hover:bg-accent-dark text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Joining..." : "Join Chat"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
