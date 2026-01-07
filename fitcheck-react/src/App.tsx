import { useEffect, useRef, useState } from 'react';
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import './App.css';
import shirtImage from "./assets/shirt.png";

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shirtRef = useRef<HTMLImageElement>(null);

  const [dragging, setDragging] = useState(false);
  const [shirtPos, setShirtPos] = useState({ x: 220, y: 150});
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    async function startCamera() {
      if (videoRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoRef.current.srcObject = stream;
      }
    }
    startCamera();
  }, []);

  

  const handleMouseDown = (e : React.MouseEvent<HTMLImageElement, MouseEvent>) => {
    if (!shirtRef.current || !containerRef.current) return;

    const shirtRect = shirtRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    setOffset({
      x: mouseX - shirtRect.left + containerRect.left,
      y: mouseY - shirtRect.top + containerRect.top,
    });

    setDragging(true);
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (!dragging || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    
    const x = e.clientX - containerRect.left - offset.x;
    const y = e.clientY - containerRect.top - offset.y;

    setShirtPos({x, y});
  };

  return (
    <div 
      ref={containerRef}
      className="container"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}  
    >
      <video ref={videoRef} autoPlay playsInline className="video" />
      <img
        ref={shirtRef}
        src={shirtImage}
        alt="Shirt"
        className="shirt"
        style={{ left: shirtPos.x, top: shirtPos.y }}
        onMouseDown={handleMouseDown}
        draggable={false}
      />
    </div>
  );
}

export default App
