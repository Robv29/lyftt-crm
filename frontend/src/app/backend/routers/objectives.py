import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.objectives import ObjectivesService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/objectives", tags=["objectives"])


# ---------- Pydantic Schemas ----------
class ObjectivesData(BaseModel):
    """Entity data schema (for create/update)"""
    objectif_appels_jour: int = None
    objectif_visios_semaine: int = None
    objectif_signatures_mois: int = None
    mois: str = None
    created_at: Optional[datetime] = None


class ObjectivesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    objectif_appels_jour: Optional[int] = None
    objectif_visios_semaine: Optional[int] = None
    objectif_signatures_mois: Optional[int] = None
    mois: Optional[str] = None
    created_at: Optional[datetime] = None


class ObjectivesResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    objectif_appels_jour: Optional[int] = None
    objectif_visios_semaine: Optional[int] = None
    objectif_signatures_mois: Optional[int] = None
    mois: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ObjectivesListResponse(BaseModel):
    """List response schema"""
    items: List[ObjectivesResponse]
    total: int
    skip: int
    limit: int


class ObjectivesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[ObjectivesData]


class ObjectivesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: ObjectivesUpdateData


class ObjectivesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[ObjectivesBatchUpdateItem]


class ObjectivesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=ObjectivesListResponse)
async def query_objectivess(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query objectivess with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying objectivess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = ObjectivesService(db)
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
        logger.debug(f"Found {result['total']} objectivess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying objectivess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=ObjectivesListResponse)
async def query_objectivess_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query objectivess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying objectivess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = ObjectivesService(db)
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
        logger.debug(f"Found {result['total']} objectivess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying objectivess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=ObjectivesResponse)
async def get_objectives(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single objectives by ID (user can only see their own records)"""
    logger.debug(f"Fetching objectives with id: {id}, fields={fields}")
    
    service = ObjectivesService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Objectives with id {id} not found")
            raise HTTPException(status_code=404, detail="Objectives not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching objectives {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=ObjectivesResponse, status_code=201)
async def create_objectives(
    data: ObjectivesData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new objectives"""
    logger.debug(f"Creating new objectives with data: {data}")
    
    service = ObjectivesService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create objectives")
        
        logger.info(f"Objectives created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating objectives: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating objectives: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[ObjectivesResponse], status_code=201)
async def create_objectivess_batch(
    request: ObjectivesBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple objectivess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} objectivess")
    
    service = ObjectivesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} objectivess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[ObjectivesResponse])
async def update_objectivess_batch(
    request: ObjectivesBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple objectivess in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} objectivess")
    
    service = ObjectivesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} objectivess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=ObjectivesResponse)
async def update_objectives(
    id: int,
    data: ObjectivesUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing objectives (requires ownership)"""
    logger.debug(f"Updating objectives {id} with data: {data}")

    service = ObjectivesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Objectives with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Objectives not found")
        
        logger.info(f"Objectives {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating objectives {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating objectives {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_objectivess_batch(
    request: ObjectivesBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple objectivess by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} objectivess")
    
    service = ObjectivesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} objectivess successfully")
        return {"message": f"Successfully deleted {deleted_count} objectivess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_objectives(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single objectives by ID (requires ownership)"""
    logger.debug(f"Deleting objectives with id: {id}")
    
    service = ObjectivesService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Objectives with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Objectives not found")
        
        logger.info(f"Objectives {id} deleted successfully")
        return {"message": "Objectives deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting objectives {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")