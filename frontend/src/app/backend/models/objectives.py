from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Objectives(Base):
    __tablename__ = "objectives"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    objectif_appels_jour = Column(Integer, nullable=True, default=30, server_default='30')
    objectif_visios_semaine = Column(Integer, nullable=True, default=5, server_default='5')
    objectif_signatures_mois = Column(Integer, nullable=True, default=3, server_default='3')
    mois = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)