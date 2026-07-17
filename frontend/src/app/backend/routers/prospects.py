import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.prospects import ProspectsService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/prospects", tags=["prospects"])


# ---------- Pydantic Schemas ----------
class ProspectsData(BaseModel):
    """Entity data schema (for create/update)"""
    nom_societe: str
    nom_dirigeant: str = None
    telephone: str = None
    email: str = None
    zone_geographique: str = None
    categorie_metier: str = None
    commercial_assigne: str = None
    statut_avancement: str = None
    date_dernier_appel: Optional[datetime] = None
    date_prochaine_relance: Optional[datetime] = None
    nombre_appels: int = None
    nombre_relances: int = None
    date_visio: Optional[datetime] = None
    date_demande_documents: Optional[datetime] = None
    date_signature: Optional[datetime] = None
    notes: str = None
    priorite: str = None
    source_lead: str = None
    montant_potentiel: float = None
    statut_gagne_perdu: str = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProspectsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    nom_societe: Optional[str] = None
    nom_dirigeant: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    zone_geographique: Optional[str] = None
    categorie_metier: Optional[str] = None
    commercial_assigne: Optional[str] = None
    statut_avancement: Optional[str] = None
    date_dernier_appel: Optional[datetime] = None
    date_prochaine_relance: Optional[datetime] = None
    nombre_appels: Optional[int] = None
    nombre_relances: Optional[int] = None
    date_visio: Optional[datetime] = None
    date_demande_documents: Optional[datetime] = None
    date_signature: Optional[datetime] = None
    notes: Optional[str] = None
    priorite: Optional[str] = None
    source_lead: Optional[str] = None
    montant_potentiel: Optional[float] = None
    statut_gagne_perdu: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProspectsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    nom_societe: str
    nom_dirigeant: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    zone_geographique: Optional[str] = None
    categorie_metier: Optional[str] = None
    commercial_assigne: Optional[str] = None
    statut_avancement: Optional[str] = None
    date_dernier_appel: Optional[datetime] = None
    date_prochaine_relance: Optional[datetime] = None
    nombre_appels: Optional[int] = None
    nombre_relances: Optional[int] = None
    date_visio: Optional[datetime] = None
    date_demande_documents: Optional[datetime] = None
    date_signature: Optional[datetime] = None
    notes: Optional[str] = None
    priorite: Optional[str] = None
    source_lead: Optional[str] = None
    montant_potentiel: Optional[float] = None
    statut_gagne_perdu: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProspectsListResponse(BaseModel):
    """List response schema"""
    items: List[ProspectsResponse]
    total: int
    skip: int
    limit: int


class ProspectsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ProspectsData]


class ProspectsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ProspectsUpdateData


class ProspectsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ProspectsBatchUpdateItem]


class ProspectsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ProspectsListResponse)
async def query_prospectss(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query prospectss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying prospectss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ProspectsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} prospectss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying prospectss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ProspectsListResponse)
async def query_prospectss_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query prospectss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying prospectss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ProspectsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} prospectss")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying prospectss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ProspectsResponse)
async def get_prospects(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single prospects by ID (user can only see their own records)"""
    logger.debug(f"Fetching prospects with id: {id}, fields={fields}")
    
    service = ProspectsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Prospects with id {id} not found")
            raise HTTPException(status_code=404, detail="Prospects not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching prospects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ProspectsResponse, status_code=201)
async def create_prospects(
    data: ProspectsData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new prospects"""
    logger.debug(f"Creating new prospects with data: {data}")
    
    service = ProspectsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create prospects")
        
        logger.info(f"Prospects created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating prospects: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating prospects: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ProspectsResponse], status_code=201)
async def create_prospectss_batch(
    request: ProspectsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple prospectss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} prospectss")
    
    service = ProspectsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} prospectss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ProspectsResponse])
async def update_prospectss_batch(
    request: ProspectsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple prospectss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} prospectss")
    
    service = ProspectsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} prospectss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ProspectsResponse)
async def update_prospects(
    id: int,
    data: ProspectsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing prospects (requires ownership)"""
    logger.debug(f"Updating prospects {id} with data: {data}")

    service = ProspectsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Prospects with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Prospects not found")
        
        logger.info(f"Prospects {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating prospects {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating prospects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_prospectss_batch(
    request: ProspectsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple prospectss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} prospectss")
    
    service = ProspectsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} prospectss successfully")
        return {"message": f"Successfully deleted {deleted_count} prospectss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_prospects(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single prospects by ID (requires ownership)"""
    logger.debug(f"Deleting prospects with id: {id}")
    
    service = ProspectsService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Prospects with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Prospects not found")
        
        logger.info(f"Prospects {id} deleted successfully")
        return {"message": "Prospects deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting prospects {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")