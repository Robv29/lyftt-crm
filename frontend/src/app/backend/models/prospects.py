from core.database import Base
from sqlalchemy import Column, DateTime, Float, Integer, String


class Prospects(Base):
    __tablename__ = "prospects"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    user_id = Column(String, nullable=False)
    nom_societe = Column(String, nullable=False)
    nom_dirigeant = Column(String, nullable=True)
    telephone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    zone_geographique = Column(String, nullable=True)
    categorie_metier = Column(String, nullable=True)
    commercial_assigne = Column(String, nullable=True)
    statut_avancement = Column(String, nullable=True, default='Appel téléphonique', server_default='Appel téléphonique')
    date_dernier_appel = Column(DateTime(timezone=True), nullable=True)
    date_prochaine_relance = Column(DateTime(timezone=True), nullable=True)
    nombre_appels = Column(Integer, nullable=True, default=0, server_default='0')
    nombre_relances = Column(Integer, nullable=True, default=0, server_default='0')
    date_visio = Column(DateTime(timezone=True), nullable=True)
    date_demande_documents = Column(DateTime(timezone=True), nullable=True)
    date_signature = Column(DateTime(timezone=True), nullable=True)
    notes = Column(String, nullable=True)
    priorite = Column(String, nullable=True, default='moyenne', server_default='moyenne')
    source_lead = Column(String, nullable=True)
    montant_potentiel = Column(Float, nullable=True, default=0, server_default='0')
    statut_gagne_perdu = Column(String, nullable=True, default='actif', server_default='actif')
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)