from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def length(self) -> float:
        return (self.x * self.x + self.y * self.y) ** 0.5

def make_point(x: float, y: float) -> Point:
    return Point(x, y)
