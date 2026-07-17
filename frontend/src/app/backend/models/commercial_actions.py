from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Commercial_actions(Base):
    __tablename__ = "commercial_actions"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    prospect_id = Column(Integer, nullable=False)
    action_type = Column(String, nullable=False)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    action_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)